/**
 * Unit tests for the dsh-sidechain plugin: command registration, `/side` and
 * `/btw` semantics against a stubbed subagent service, pinned prompt text, and
 * config-driven wiring.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandDefinition, CommandId, CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentCatalogEntry,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import { apply } from '../src/index'
import { createSidechainCommands } from '../src/commands'
import { SIDE_BOUNDARY_PROMPT, SIDE_MODE_LINE, SIDE_PERSONA } from '../src/prompts'
import {
  formatSideList,
  truncateLabel,
  type SideDeps,
  type SubagentsLike,
} from '../src/side'

const PARENT_ID = 'parent-1' as SessionId
const CHILD_ID = 'child-9' as SessionId

const agent = { session: { id: PARENT_ID } } as never

const DEFAULT_DEPS: SideDeps = {
  providerName: 'fork',
  persona: SIDE_PERSONA,
}

// The command handlers persist the child-id registry under DSH_HOME; point it
// at a scratch dir so tests never touch the real home.
beforeEach(() => {
  vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'dsh-sidechain-spec-')))
})
afterEach(() => {
  vi.unstubAllEnvs()
})

interface Harness {
  subagents: SubagentsLike & {
    startActivation: ReturnType<typeof vi.fn>
    listChildren: ReturnType<typeof vi.fn>
    getProvider: ReturnType<typeof vi.fn>
  }
  commands: CommandDefinition[]
  noteChild: ReturnType<typeof vi.fn>
  reserveChild: ReturnType<typeof vi.fn>
  expectChild: ReturnType<typeof vi.fn>
}

function makeHarness(deps: SideDeps = DEFAULT_DEPS): Harness {
  const subagents = {
    startActivation: vi.fn(),
    listChildren: vi.fn(),
    getProvider: vi.fn(() => ({ name: deps.providerName })),
  } as unknown as Harness['subagents']
  const noteChild = vi.fn()
  const reserveChild = vi.fn(() => CHILD_ID)
  const expectChild = vi.fn()
  const commands = createSidechainCommands(subagents, deps, { noteChild, reserveChild }, { expect: expectChild })
  return { subagents, commands, noteChild, reserveChild, expectChild }
}

function invoke(
  command: CommandDefinition,
  rawInput: string,
  signal = new AbortController().signal,
  attachments: readonly ContentBlock[] = [],
): ReturnType<NonNullable<CommandDefinition['handler']>> {
  return command.handler({ commandId: 'cmd-test-1' as CommandId, agent, rawInput, attachments, signal } as CommandInvocation)
}

function textOf(block: ContentBlock): string {
  return block.type === 'text' ? block.text : ''
}

/** A minimal started run; by default its result never settles (still running). */
function runOf(result: Promise<unknown> = new Promise<never>(() => {})): SubagentActivation {
  return {
    childId: CHILD_ID,
    local: true,
    stopReason: 'completed',
    lastAssistantMessage: [],
    result,
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubagentActivation
}

type ChildEntry = SubagentCatalogEntry

function childEntry(partial: Partial<ChildEntry> = {}): SubagentCatalogEntry {
  const mode = partial.mode ?? 'continuable'
  const label = (partial as { label?: string }).label
  return {
    id: partial.id ?? CHILD_ID,
    createdAt: 0,
    mode,
    ...(mode === 'continuable'
      ? { label: label ?? 'Side conversation' }
      : label === undefined ? {} : { label }),
  } as SubagentCatalogEntry
}

describe('pinned prompt text', () => {
  it('boundary marks inherited history as reference context only', () => {
    expect(SIDE_BOUNDARY_PROMPT).toContain('Side conversation boundary.')
    expect(SIDE_BOUNDARY_PROMPT).toContain('It is reference context only.')
    expect(SIDE_BOUNDARY_PROMPT).toContain('Only messages submitted after this boundary are active user instructions')
  })

  it('declares the /side vs /btw mode so the child cannot misidentify itself', () => {
    expect(SIDE_MODE_LINE.side).toContain('/side side conversation')
    expect(SIDE_MODE_LINE.side).toContain('continuable thread')
    expect(SIDE_MODE_LINE.btw).toContain('/btw one-shot side question')
    expect(SIDE_MODE_LINE.btw).toContain('Answer once')
  })

  it('persona forbids mutation unless asked and keeps sub-agents off-limits', () => {
    expect(SIDE_PERSONA).toContain('Do not modify files, source, git state, permissions, configuration, or workspace state unless the user explicitly asks')
    expect(SIDE_PERSONA).toContain('Sub-agents are off-limits in this side conversation')
    expect(SIDE_PERSONA).not.toContain('{{')
  })
})

describe('command registration', () => {
  it('declares argument hints and keeps both questions out of the parent log', () => {
    const { commands } = makeHarness()
    expect(commands[0]?.input).toEqual({ hint: '<question>', attachments: true })
    expect(commands[1]?.input).toEqual({ hint: '<question>', attachments: true })
    expect(commands[0]?.recordInput).toBe(false)
    expect(commands[1]?.recordInput).toBe(false)
  })

})

describe('/btw (non-blocking one-shot side question)', () => {
  it('starts a one-shot run with boundary + question and returns the child id', async () => {
    const { subagents, commands, noteChild, expectChild } = makeHarness()
    subagents.startActivation.mockResolvedValue(runOf())

    const result = await invoke(commands[1]!, '  what is 6*7?  ')

    expect(result).toEqual({ kind: 'success', text: `BTW question started: ${String(CHILD_ID)}.` })
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
    expect(subagents.startActivation).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'fork',
      label: 'BTW: what is 6*7?',
      childId: CHILD_ID,
      delivery: 'caller',
      request: expect.objectContaining({ parent: agent }),
    }))
    const request = subagents.startActivation.mock.calls[0]![0].request as SubagentStartRequest
    const prompt = textOf(request.prompt[0]!)
    expect(prompt).toContain(SIDE_MODE_LINE.btw)
    expect(prompt).toContain(SIDE_BOUNDARY_PROMPT)
    expect(prompt).toContain('what is 6*7?')
    // The rc.2 start request no longer carries persona/toolFilter: composition
    // is applied to the child's own scope once its agent exists.
    expect(request).not.toHaveProperty('persona')
    expect(expectChild).toHaveBeenCalledWith(CHILD_ID)
    expect(noteChild).toHaveBeenCalledWith(agent, CHILD_ID)
  })

  it('forwards admitted image blocks into the child prompt', async () => {
    const { subagents, commands } = makeHarness()
    subagents.startActivation.mockResolvedValue(runOf())
    const image = {
      type: 'image',
      attachment: {
        attachmentId: 'image-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1,
      },
    } as unknown as ContentBlock

    await invoke(commands[1]!, 'describe this', new AbortController().signal, [image])

    const request = subagents.startActivation.mock.calls[0]![0].request as SubagentStartRequest
    expect(request.prompt).toEqual(expect.arrayContaining([image]))
  })

  it('resolves without awaiting the child result — the input stays free', async () => {
    const { subagents, commands } = makeHarness()
    // A never-settling result: the handler still returns immediately.
    const run = runOf()
    subagents.startActivation.mockResolvedValue(run)

    const result = await invoke(commands[1]!, 'question')

    // The handler returns while the child is still running — the main session
    // input stays free and the panel streams the answer from the child. The
    // background release awaits the settlement, so nothing disposes yet.
    expect(result.kind).toBe('success')
    expect(run.dispose).not.toHaveBeenCalled()
  })

  it('disposes the run once its result settles (release contract)', async () => {
    const { subagents, commands } = makeHarness()
    const run = runOf(Promise.resolve({ output: [], structured: undefined, stopReason: 'completed' }))
    subagents.startActivation.mockResolvedValue(run)

    const result = await invoke(commands[1]!, 'question')
    expect(result.kind).toBe('success')

    // The background release chain (result → dispose) drains after the turn.
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(run.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes even when the child run fails', async () => {
    const { subagents, commands } = makeHarness()
    const run = runOf(Promise.reject(new Error('child crash')))
    subagents.startActivation.mockResolvedValue(run)

    await invoke(commands[1]!, 'question')

    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(run.dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty question without calling the provider', async () => {
    const { subagents, commands } = makeHarness()
    const result = await invoke(commands[1]!, '   ')

    expect(result).toEqual({ kind: 'error', text: '/btw requires a question: /btw <question>' })
    expect(subagents.startActivation).not.toHaveBeenCalled()
  })

  it('fails loud with a mount hint when the provider is missing', async () => {
    const { subagents, commands } = makeHarness()
    subagents.getProvider.mockReturnValue(undefined)

    const result = await invoke(commands[1]!, 'question')

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.text).toContain('provider "fork" is not registered')
    expect(result.kind === 'error' && result.text).toContain('@deepseek-ai/dsh-subagent-fork-in-process')
    expect(subagents.startActivation).not.toHaveBeenCalled()
  })

  it('returns an error result when starting the child fails', async () => {
    const { subagents, commands } = makeHarness()
    subagents.startActivation.mockRejectedValue(new Error('boom'))

    const result = await invoke(commands[1]!, 'question')

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.text).toContain('/btw failed: boom')
  })
})

describe('/side (continuable side thread)', () => {
  it('starts a continuable fork child labeled from the question', async () => {
    const { subagents, commands, noteChild, reserveChild, expectChild } = makeHarness()
    const order: string[] = []
    reserveChild.mockImplementation(() => { order.push('reserve'); return CHILD_ID })
    subagents.startActivation.mockImplementation(async (spec: SubagentActivationSpec) => {
      order.push('start')
      return { childId: spec.childId, messageId: 'm1' } as SubagentActivation
    })

    const result = await invoke(commands[0]!, '  investigate the plugin seams  ')

    expect(result).toEqual({ kind: 'success', text: `Side conversation started: ${String(CHILD_ID)}.` })
    expect(order).toEqual(['reserve', 'start'])
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
    const spec = subagents.startActivation.mock.calls[0]![0] as SubagentActivationSpec
    expect(spec.childId).toBe(CHILD_ID)
    expect(spec.provider).toBe('fork')
    expect(spec.label).toBe('investigate the plugin seams')
    expect(spec.request.parent).toBe(agent)
    expect(spec.request).not.toHaveProperty('persona')
    expect(expectChild).toHaveBeenCalledWith(CHILD_ID)
    const prompt = textOf(spec.request.prompt[0]!)
    expect(prompt).toContain(SIDE_MODE_LINE.side)
    expect(prompt).toContain(SIDE_BOUNDARY_PROMPT)
    expect(prompt).toContain('investigate the plugin seams')
    expect(noteChild).toHaveBeenCalledWith(agent, CHILD_ID)
  })

  it('lists children of the current session through /side list', async () => {
    const { subagents, commands } = makeHarness()
    subagents.listChildren.mockResolvedValue([
      childEntry({ label: 'seams research' }),
      childEntry({ mode: 'one-shot', label: 'BTW: quick check' }),
    ])

    const result = await invoke(commands[0]!, 'list')

    expect(subagents.listChildren).toHaveBeenCalledWith(PARENT_ID, expect.any(AbortSignal))
    expect(result.kind).toBe('success')
    const text = result.kind === 'success' ? result.text : ''
    expect(text).toContain('[side] seams research')
    expect(text).toContain('[btw] BTW: quick check')
  })

  it('reports an empty catalog', async () => {
    const { subagents, commands } = makeHarness()
    subagents.listChildren.mockResolvedValue([])

    const result = await invoke(commands[0]!, 'ls')

    expect(result).toEqual({ kind: 'success', text: 'No side conversations yet. Start one with /side <question>.' })
  })
})

describe('text helpers', () => {
  it('builds one-line labels from question prefixes', () => {
    expect(truncateLabel('  multiple   spaces  ')).toBe('multiple spaces')
    expect(truncateLabel('')).toBe('')
    expect(truncateLabel('🙂'.repeat(60))).toContain('…')
  })

  it('formats an empty catalog and mixed entries', () => {
    expect(formatSideList([])).toBe('No side conversations yet. Start one with /side <question>.')
    const text = formatSideList([
      childEntry({ mode: 'one-shot' }),
      childEntry({ mode: 'continuable', label: 'named side' }),
    ])
    expect(text).toContain('[btw] (one-shot)')
    expect(text).toContain('[side] named side')
  })
})

describe('plugin wiring', () => {
  it('registers both commands when a command registry is composed', () => {
    const registered: CommandDefinition[] = []
    const fakeCtx = {
      subagents: makeHarness().subagents,
      sessionProjections: { register: vi.fn() },
      agents: { list: () => [] },
      on: vi.fn(() => () => {}),
      inject: (_deps: string[], callback: (inner: { commands: { register: (d: CommandDefinition) => void } }) => void) => {
        callback({ commands: { register: definition => { registered.push(definition) } } })
      },
    }
    apply(fakeCtx as never, { providerName: 'fork', persona: SIDE_PERSONA })

    expect(registered.map(definition => definition.name)).toEqual(['side', 'btw'])
  })

  it('applies the configured readOnlyTools allow-list to the side child scope', async () => {
    const harness = makeHarness()
    const registered: CommandDefinition[] = []
    const listeners: Array<(payload: { agent: unknown }) => unknown> = []
    const fakeCtx = {
      subagents: harness.subagents,
      sessionProjections: { register: vi.fn() },
      agents: { list: () => [] },
      on: vi.fn((_name: string, listener: (payload: { agent: unknown }) => unknown) => {
        listeners.push(listener)
        return () => {}
      }),
      inject: (_deps: string[], callback: (inner: { commands: { register: (d: CommandDefinition) => void } }) => void) => {
        callback({ commands: { register: definition => { registered.push(definition) } } })
      },
    }
    apply(fakeCtx as never, {
      providerName: 'fork',
      persona: SIDE_PERSONA,
      readOnlyTools: ['read', 'grep'],
    })

    harness.subagents.startActivation.mockResolvedValue(runOf())
    await invoke(registered[1]!, 'question')

    const restrict = vi.fn()
    const section = vi.fn()
    const child = {
      id: CHILD_ID,
      session: { id: CHILD_ID },
      ctx: { systemPrompt: { section }, tools: { restrict } },
    }
    for (const listener of listeners) listener({ agent: child })

    expect(restrict).toHaveBeenCalledWith({ allow: ['read', 'grep'] })
    expect(section).toHaveBeenCalledWith(expect.objectContaining({
      name: 'deployment:persona-prefix',
      text: SIDE_PERSONA,
    }))
  })
})
