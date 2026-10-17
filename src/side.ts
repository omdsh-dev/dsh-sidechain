/**
 * Side-conversation operations over the `ctx.subagents` fork provider.
 *
 * Both commands share one mechanism (Codex semantics): fork the current
 * session — the child inherits the parent's completed conversation turns as
 * reference context only — then either start a one-shot side question (`/btw`,
 * whose answer streams into the sidechain panel) or open a durable
 * continuable side thread (`/side`).
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentCatalogEntry,
} from '@deepseek-ai/dsh-subagent'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { SIDE_BOUNDARY_PROMPT, SIDE_MODE_LINE, type SideMode } from './prompts.ts'
import type { SidechainModes } from './sidechain-projection.ts'

/** Minimal structural face of the subagent service this plugin consumes. */
export interface SubagentsLike {
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>
  listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentCatalogEntry[]>
  getProvider(name: string): { readonly name: string } | undefined
}

/** Shared side-conversation behavior for both commands. */
export interface SideDeps {
  /** Provider name on `ctx.subagents`; the fork backend registers as `fork`. */
  providerName: string
  /** Persona shadowing the deployment persona inside side-conversation children. */
  persona?: string
  /** Optional allow-list restriction applied to side-conversation children. */
  toolFilter?: ToolRestriction
}

/** Maximum code points kept in a durable child label. */
export const LABEL_MAX_CHARS = 48

/** One text content block. */
export function textBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

/**
 * The side conversation's opening user message: the boundary prompt (with the
 * mode declaration inside it), then the user's question. The message opens
 * with `Side conversation boundary` so the panel's boundary-row drop keeps
 * hiding the whole internal prompt.
 * @param question - the user's question.
 * @param mode - which command created the child; declared to the child so it
 *   can never misidentify itself.
 */
export function sidePrompt(
  question: string,
  mode: SideMode,
  attachments: readonly ContentBlock[] = [],
): ContentBlock[] {
  return [
    textBlock(`${SIDE_BOUNDARY_PROMPT}\n\n${SIDE_MODE_LINE[mode]}\n\n${question.trim()}`),
    ...attachments,
  ]
}

/**
 * Start one side question (`/btw`): a fork activation whose
 * answer streams into the sidechain panel; the child session stays out of the
 * main history. The caller returns as soon as the run is started — nothing
 * here waits for the child to settle.
 */
export function askSideOneShot(
  subagents: SubagentsLike,
  parent: Agent,
  question: string,
  deps: SideDeps,
  signal: AbortSignal,
  attachments: readonly ContentBlock[] = [],
  childId?: SessionId,
): Promise<SubagentActivation> {
  return subagents.startActivation({
    provider: deps.providerName,
    label: `BTW: ${truncateLabel(question)}`,
    ...(childId === undefined ? {} : { childId }),
    request: {
      prompt: sidePrompt(question, 'btw', attachments),
      parent,
    },
    signal,
    delivery: 'caller',
  })
}

/**
 * Start a durable continuable side thread (`/side`): a named fork child that
 * keeps its own session, appears in the web subagent catalog, and can be
 * continued while the main thread keeps running.
 */
export function startSideConversation(
  subagents: SubagentsLike,
  parent: Agent,
  question: string,
  deps: SideDeps,
  signal: AbortSignal,
  attachments: readonly ContentBlock[] = [],
  childId?: SessionId,
): Promise<SubagentActivation> {
  const label = truncateLabel(question) || 'Side conversation'
  return subagents.startActivation({
    provider: deps.providerName,
    label,
    ...(childId === undefined ? {} : { childId }),
    request: {
      prompt: sidePrompt(question, 'side', attachments),
      parent,
    },
    signal,
    delivery: 'caller',
  })
}

/** One-line label from the question's first words; empty when there is none. */
export function truncateLabel(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  const chars = [...normalized]
  return chars.length <= LABEL_MAX_CHARS ? normalized : chars.slice(0, LABEL_MAX_CHARS).join('') + '…'
}

/** Render the direct-child catalog as readable lines for `/side list`. */
export function formatSideList(entries: readonly SubagentCatalogEntry[], modes: SidechainModes = {}): string {
  if (entries.length === 0) {
    return 'No side conversations yet. Start one with /side <question>.'
  }
  const lines = entries.map((entry) => {
    const mode = modes[entry.id] ?? (entry.mode === 'one-shot' ? 'btw' : entry.mode === 'continuable' ? 'side' : entry.mode)
    return `- [${mode}] ${entry.label ?? '(one-shot)'} — ${entry.id}`
  })
  return lines.join('\n')
}
