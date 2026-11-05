/**
 * Command cards for `/side` and `/btw` (browser half). Live child discovery
 * is owned by the always-mounted composer observer, not
 * the card: blank sessions deliberately do not render chat rows, and fast
 * commands may settle before a row mounts.
 *
 */

import type { CommandNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sideCommandResult } from '../command-result.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeChildActions } from './native-sidebar.tsx'
import { NS } from './locales.ts'

/** Props supplied by the keyed command row. */
export interface SideCommandCardProps extends NativeChildActions, PropsLocale<typeof NS> {
  node: CommandNode
}

/** Command key → child mode carried by the host's success text marker. */
export type SideCommandKind = 'side' | 'btw'

const MARKDOWN_LABELS = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
} as const

/**
 * Resolve the created child session id from a settled command node, or
 * undefined while the command is running, failed, or the id is absent.
 * The host pins the id in a stable marker: `/side` texts start with
 * `Side conversation started: <uuid>.`, `/btw` texts with
 * `BTW question started: <uuid>.`.
 */
export function resolveChildSessionId(node: CommandNode, kind: SideCommandKind): SessionId | undefined {
  const created = sideCommandResult(node.outcome)
  return created?.mode === kind ? created.childId : undefined
}

/** Last resolved child id for each observed sidechain command. */
export type ObservedSideCommands = ReadonlyMap<CommandNode['commandId'], SessionId | undefined>

/**
 * Fold one command-node snapshot into the observer state.
 *
 * The first snapshot is a replay baseline and emits nothing. Later snapshots
 * emit a child when a post-mount command appears already settled or an
 * observed pending command settles. The mount timestamp excludes late
 * history hydration; recording the resolved id makes repeats idempotent.
 */
export function observeCreatedChildren(
  previous: ObservedSideCommands | undefined,
  nodes: readonly CommandNode[],
  startedAt: number,
): { known: ObservedSideCommands; children: readonly SessionId[] } {
  const known = new Map(previous)
  const children: SessionId[] = []
  for (const node of nodes) {
    if (node.name !== 'side' && node.name !== 'btw') continue
    const child = resolveChildSessionId(node, node.name)
    if (
      previous !== undefined
      && node.time >= startedAt
      && child !== undefined
      && previous.get(node.commandId) !== child
    ) {
      children.push(child)
    }
    known.set(node.commandId, child)
  }
  return { known, children }
}

/** The command card can reopen history; the composer observer owns live discovery. */
export function SideCommandCard({ node, openChild, t }: SideCommandCardProps): JSX.Element {
  const kind: SideCommandKind = node.name === 'btw' ? 'btw' : 'side'
  const childId = resolveChildSessionId(node, kind)
  const outcome = node.outcome
  const label = outcome === null
    ? '…'
    : outcome.kind === 'error'
      ? (outcome.text ?? '')
      : (outcome.text ?? `/${kind}`)
  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-module-platform, #f5f6f7)',
        fontSize: '13px',
        lineHeight: '1.5',
      }}
    >
      <strong style={{ whiteSpace: 'nowrap', display: 'block', marginBottom: '2px' }}>/{node.name ?? kind}</strong>
      {/* The /btw answer and /side notice render as markdown (tables, code, lists). */}
      <div style={{ overflowX: 'auto' }}>
        <MarkdownText text={label} streaming={false} labels={MARKDOWN_LABELS} />
      </div>
      {childId !== undefined && <Button size="sm" onClick={() => openChild(childId)}>{t('view.open')}</Button>}
    </div>
  )
}
