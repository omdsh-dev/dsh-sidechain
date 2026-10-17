/**
 * Command definitions for `/side` and `/btw` (Codex semantics: both start a
 * side conversation in a fork of the current session). Neither
 * command blocks the main session: the child runs in the background and its
 * transcript streams into the sidechain panel.
 */

import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { ChildComposition } from './child-composition.ts'
import type { SettlementSilence } from './settle-silence.ts'
import {
  askSideOneShot,
  formatSideList,
  startSideConversation,
  type SideDeps,
  type SubagentsLike,
} from './side.ts'

/** Build the two commands against a subagent-service face. */
export function createSidechainCommands(
  subagents: SubagentsLike,
  deps: SideDeps,
  settlementSilence: Pick<SettlementSilence, 'noteChild' | 'reserveChild'>,
  childComposition: Pick<ChildComposition, 'expect'>,
  projections?: Pick<SessionProjectionRegistry, 'snapshot'>,
): CommandDefinition[] {
  /** Loud hint when the configured provider is absent from the deployment. */
  const missingProvider = (): string | undefined => {
    if (subagents.getProvider(deps.providerName) !== undefined) return undefined
    return `sidechain: provider "${deps.providerName}" is not registered — mount @deepseek-ai/dsh-subagent-fork-in-process (or set providerName in the plugin config).`
  }

  return [
    {
      name: 'side',
      description: 'Start a side conversation in a fork of the current session',
      recordInput: false,
      input: { hint: '<question>', attachments: true },
      handler: async ({ agent, rawInput, attachments, signal }) => {
        const missing = missingProvider()
        if (missing !== undefined) return { kind: 'error', text: missing }
        const arg = rawInput.trim()
        if (arg === 'list' || arg === 'ls') {
          try {
            const entries = await subagents.listChildren(agent.session.id, signal)
            const modes = projections?.snapshot(agent.session, ['sidechainModes']).values.sidechainModes
            return { kind: 'success', text: formatSideList(entries, modes) }
          } catch (error) {
            return { kind: 'error', text: `sidechain: failed to list side conversations: ${messageOf(error)}` }
          }
        }
        if (arg === '') {
          return { kind: 'error', text: '/side requires a question: /side <question>' }
        }
        try {
          const reservedChildId = settlementSilence.reserveChild(agent)
          childComposition.expect(reservedChildId)
          const { childId } = await startSideConversation(
            subagents, agent, arg, deps, signal, attachments, reservedChildId,
          )
          // Stop this child's settlement notice at the parent inbox boundary;
          // the child remains visible in the sidechain panel.
          settlementSilence.noteChild(agent, childId)
          // The trailing id is the machine-readable jump target for the client card.
          return { kind: 'success', text: `Side conversation started: ${childId}.` }
        } catch (error) {
          return { kind: 'error', text: `sidechain: failed to start side conversation: ${messageOf(error)}` }
        }
      },
    },
    {
      name: 'btw',
      description: 'Ask a quick question in a fork of the current session',
      // The question body is not persisted into the parent's command/run log:
      // the child session is the durable record (the panel reads it there).
      recordInput: false,
      input: { hint: '<question>', attachments: true },
      handler: async ({ agent, rawInput, attachments, signal }) => {
        const question = rawInput.trim()
        if (question === '') {
          return { kind: 'error', text: '/btw requires a question: /btw <question>' }
        }
        const missing = missingProvider()
        if (missing !== undefined) return { kind: 'error', text: missing }
        try {
          // Non-blocking one-shot: the child keeps running in the background
          // and its answer streams into the sidechain panel — the main
          // session input stays free, nothing is awaited past the start.
          const reservedChildId = settlementSilence.reserveChild(agent)
          childComposition.expect(reservedChildId)
          const run = await askSideOneShot(subagents, agent, question, deps, signal, attachments, reservedChildId)
          // Stop this child's settlement notice at the parent inbox boundary;
          // the child remains visible in the sidechain panel.
          settlementSilence.noteChild(agent, run.childId)
          void run.result
            .catch(() => { /* settlement failure still needs the release */ })
            .then(() => run.dispose().catch(() => { /* disposal must not mask the command result */ }))
          // The trailing id is the machine-readable jump target for the client card.
          return { kind: 'success', text: `BTW question started: ${run.childId}.` }
        } catch (error) {
          return { kind: 'error', text: `sidechain: /btw failed: ${messageOf(error)}` }
        }
      },
    },
  ]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
