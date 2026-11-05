import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { apply } from '../src/index'
import { createSettlementSilence } from '../src/settle-silence'

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sidechain-tools-'))
  vi.stubEnv('DSH_HOME', home)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

it('enforces the allow-list before a side child runs, restores it on reload, and leaves other agents alone', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    const minter = ctx.inject(['tools'], () => {})
    await minter
    const writes = vi.fn(async () => 'written')
    for (const name of ['read', 'write']) {
      ctx.tools.register(defineTool({
        name, description: name, parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: name === 'write' ? writes : async () => 'read',
      }))
    }
    const createAgent = (id: SessionId): Agent => {
      const agent = {
        id, session: Session.create(id), ctx,
        options: {}, model: { current: () => undefined, select: vi.fn() },
        status: 'idle', inbox: { nextTurn: [], nextStep: [] } as never,
        send: vi.fn(), cancel: vi.fn(), whenIdle: async () => {},
        runMaintenance: task => task(new AbortController().signal),
        followup: vi.fn(), steer: vi.fn(), inject: vi.fn(),
      } satisfies Agent
      agent.ctx = createScope(minter.ctx, agent).ctx
      return agent
    }
    const parent = createAgent(SessionId('parent'))
    const other = createAgent(SessionId('other'))
    const liveAgents = [parent, other]
    const pluginCtx = {
      agents: { list: () => liveAgents },
      sessionProjections: { register: vi.fn() },
      on: ctx.on.bind(ctx),
      effect: ctx.effect.bind(ctx),
      inject: vi.fn(),
    } as never
    const registry = createSettlementSilence(pluginCtx)
    const childId = registry.reserveChild(parent)
    registry.dispose()
    const config = { providerName: 'fork', persona: '', readOnlyTools: ['read'] }
    const unload = await apply(pluginCtx, config)
    const child = createAgent(childId)
    await ctx.serial(scopeTarget(child, scopeOf(child.ctx)), 'agent/created', { agent: child, source: 'startup' })
    const pipeline = new ToolExecutionPipeline(ctx)
    const execute = async (agent: Agent, name: string) => {
      const batch = await executeToolBatch({
        agent, signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: ToolCallId('test'), name, arguments: '{}' }],
      }, pipeline, () => 1)
      return batch.results[0]!.result
    }
    expect(ctx.tools.schemas(child).map(tool => tool.name)).toEqual(['read'])
    child.ctx.tools.register(defineTool({
      name: 'subagent', description: 'Child-local tool', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: writes,
    }))
    expect((await execute(child, 'subagent')).isError).toBe(true)
    expect((await execute(child, 'write')).isError).toBe(true)
    expect(writes).not.toHaveBeenCalled()
    expect((await execute(child, 'read')).isError).toBe(false)
    expect((await execute(parent, 'write')).isError).toBe(false)
    expect((await execute(other, 'write')).isError).toBe(false)
    unload()
    expect((await execute(child, 'write')).isError).toBe(false)
    expect((await execute(child, 'subagent')).isError).toBe(false)
    liveAgents.push(child)
    const unloadReloaded = await apply(pluginCtx, config)
    expect((await execute(child, 'write')).isError).toBe(true)
    expect((await execute(child, 'subagent')).isError).toBe(true)
    const resumed = createAgent(childId)
    await ctx.serial(scopeTarget(resumed, scopeOf(resumed.ctx)), 'agent/created', { agent: resumed, source: 'resume' })
    expect((await execute(resumed, 'write')).isError).toBe(true)
    unloadReloaded()
    expect((await execute(resumed, 'write')).isError).toBe(false)
  } finally {
    await ctx.fiber.dispose()
  }
})
