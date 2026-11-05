/**
 * dsh-sidechain plugin: `/side` and `/btw` — isolated side conversations in a
 * fork of the current session (Codex `/side` & `/btw` semantics).
 *
 * Both commands drive the forked subagent backend: the child inherits the
 * parent's completed conversation turns as reference context only (boundary
 * prompt), receives side-conversation instructions (no mutation unless asked,
 * sub-agents off-limits), and never writes into the main session's history.
 * `/side` opens a durable continuable side thread (visible in the web
 * subagent catalog); `/btw` starts a one-shot side question whose answer
 * streams into the sidechain panel. Neither command blocks the main session.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { createSidechainCommands } from './commands.ts'
import { SIDE_PERSONA } from './prompts.ts'
import { createSettlementSilence } from './settle-silence.ts'
import type { SideDeps } from './side.ts'
import { sidechainModesProjection } from './sidechain-projection.ts'

export const name = 'dsh-sidechain'

export const inject = ['agents', 'subagents', 'sessionProjections']

/** Plugin config: deployment-varying behavior, validated from cordis.yml. */
export interface Config {
  /** Provider name on `ctx.subagents`; the fork backend registers as `fork`. */
  providerName: string
  /** Side-conversation instructions appended to the opening boundary message. */
  persona: string
  /** Optional allow-list of tool names kept visible in side conversations. */
  readOnlyTools?: string[]
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('fork'),
  persona: z.string().default(SIDE_PERSONA),
  readOnlyTools: z.array(z.string()),
})

export async function apply(ctx: Context, config: Config): Promise<() => void> {
  await ctx.sessionProjections.register(sidechainModesProjection)
  const readOnlyTools = config.readOnlyTools?.length ? config.readOnlyTools : undefined
  const deps: SideDeps = {
    providerName: config.providerName,
    ...(config.persona === '' ? {} : { persona: config.persona }),
  }
  const settlementSilence = createSettlementSilence(ctx)
  const restrictions = new Map<Agent, () => void>()
  const restrictChild = (agent: Agent): void => {
    if (readOnlyTools === undefined || !settlementSilence.hasChild(agent.session.id) || restrictions.has(agent)) return
    restrictions.set(agent, agent.ctx.effect(function* () {
      yield agent.ctx.tools.restrict({ allow: readOnlyTools })
      yield agent.ctx.tools.guard(({ name }) => name === RUN_CODE_NAME || readOnlyTools.includes(name)
        ? undefined
        : `sidechain: tool "${name}" is not allowed by readOnlyTools`)
    }))
  }
  const removeCreatedListener = ctx.on('agent/created', ({ agent }) => { restrictChild(agent); return undefined })
  const removeDisposedListener = ctx.on('agent/disposed', ({ agent }) => { restrictions.delete(agent) })
  const dispose = ctx.effect(() => () => {
    removeCreatedListener()
    removeDisposedListener()
    for (const release of restrictions.values()) release()
    restrictions.clear()
    settlementSilence.dispose()
  })
  for (const agent of ctx.agents.list()) restrictChild(agent)
  // Commands are an optional surface: without a command registry the plugin
  // still loads harmlessly in minimal deployments.
  ctx.inject(['commands'], (commandCtx) => {
    for (const definition of createSidechainCommands(ctx.subagents, deps, settlementSilence, ctx.sessionProjections)) {
      commandCtx.commands.register(definition)
    }
  })
  return dispose
}
