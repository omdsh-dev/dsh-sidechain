/**
 * dsh-sidechain plugin: `/side` and `/btw` — isolated side conversations in a
 * fork of the current session (Codex `/side` & `/btw` semantics).
 *
 * Both commands drive the forked subagent backend: the child inherits the
 * parent's completed conversation turns as reference context only (boundary
 * prompt), runs under a side-conversation persona (no mutation unless asked,
 * sub-agents off-limits), and never writes into the main session's history.
 * `/side` opens a durable continuable side thread (visible in the web
 * subagent catalog); `/btw` starts a one-shot side question whose answer
 * streams into the sidechain panel. Neither command blocks the main session.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { createChildComposition } from './child-composition.ts'
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
  /** Persona applied to side-conversation children; shadows the deployment persona. */
  persona: string
  /** Optional allow-list of tool names kept visible in side conversations. */
  readOnlyTools?: string[]
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('fork'),
  persona: z.string().default(SIDE_PERSONA),
  readOnlyTools: z.array(z.string()),
})

export function apply(ctx: Context, config: Config): () => void {
  const toolFilter: ToolRestriction | undefined =
    config.readOnlyTools !== undefined && config.readOnlyTools.length > 0
      ? { allow: config.readOnlyTools }
      : undefined
  const deps: SideDeps = {
    providerName: config.providerName,
    ...(config.persona === '' ? {} : { persona: config.persona }),
    ...(toolFilter === undefined ? {} : { toolFilter }),
  }
  const settlementSilence = createSettlementSilence(ctx)
  // The rc.2 subagent seam no longer accepts persona/toolFilter on a start
  // request, so the same composition is applied to the child's own scope at its
  // creation edge.
  const childComposition = createChildComposition(
    ctx,
    {
      ...(deps.persona === undefined ? {} : { persona: deps.persona }),
      ...(toolFilter === undefined ? {} : { toolFilter }),
    },
    settlementSilence.isChild,
  )
  ctx.sessionProjections.register(sidechainModesProjection)
  // Commands are an optional surface: without a command registry the plugin
  // still loads harmlessly in minimal deployments.
  ctx.inject(['commands'], (commandCtx) => {
    for (const definition of createSidechainCommands(
      ctx.subagents,
      deps,
      settlementSilence,
      childComposition,
      ctx.sessionProjections,
    )) {
      commandCtx.commands.register(definition)
    }
  })
  return () => {
    childComposition.dispose()
    settlementSilence.dispose()
  }
}
