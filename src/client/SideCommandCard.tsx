/**
 * Command cards for `/side` and `/btw` (browser half). Live child discovery
 * is owned by the always-mounted panel host, not
 * the card: blank sessions deliberately do not render chat rows, and fast
 * commands may settle before a row mounts.
 *
 * The `/btw` card additionally streams the one-shot child's transcript
 * directly in the main conversation, so the answer appears with the same
 * token-level streaming behavior as a main-session assistant message instead
 * of only appearing after the child has settled.
 */

import type { CommandNode, SessionId, SessionListState, SubagentAddress } from '@deepseek-ai/dsh-client-runtime/client'
import { useEffect, useRef, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranscriptRow } from './sidechain-view.ts'

/** Props supplied by the keyed command row. */
export interface SideCommandCardProps {
  node: CommandNode
  /** Framework-resolved parent session id (the session whose chat row this is). */
  sessionId: SessionId
  /** Framework sessions selector; used to learn when a /btw child settles. */
  useSessions: <T>(selector: (state: SessionListState) => T) => T
  /** Reads one child's seed-cut transcript without activating it. */
  readChildTranscript: (address: SubagentAddress) => Promise<{ rows: readonly TranscriptRow[]; produced: readonly string[] } | null>
}

/** Command key → child mode carried by the host's success text marker. */
export type SideCommandKind = 'side' | 'btw'

/**
 * Resolve the created child session id from a settled command node, or
 * undefined while the command is running, failed, or the id is absent.
 * The host pins the id in a stable marker: `/side` texts start with
 * `Side conversation started: <uuid>.`, `/btw` texts with
 * `BTW question started: <uuid>.`.
 */
export function resolveChildSessionId(node: CommandNode, kind: SideCommandKind): SessionId | undefined {
  const text = node.outcome?.kind === 'success' ? node.outcome.text : undefined
  if (text === undefined) return undefined
  const pattern = kind === 'side' ? /Side conversation started: ([0-9a-f-]{36})/ : /BTW question started: ([0-9a-f-]{36})/
  return pattern.exec(text)?.[1] as SessionId | undefined
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

/** Poll interval for a running /btw card transcript (ms). */
const BTW_CARD_POLL_INTERVAL_MS = 1200

/** Inline transcript for a settled /btw command. */
function BtwTranscript({ rows, running }: {
  rows: readonly TranscriptRow[]
  running: boolean
}): JSX.Element {
  const lastIndex = rows.length - 1
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row, index) => {
        if (row.kind === 'user') {
          return (
            <div key={`${row.kind}:${row.seq}:${index}`} style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
              <div style={{
                padding: '6px 10px', borderRadius: 10,
                background: 'var(--ds-color-bg-2, #f2f3f5)',
                color: 'var(--ds-color-text-1, #1d2129)',
                width: 'fit-content', maxWidth: '100%', fontSize: 13, lineHeight: 1.5,
              }}>
                <MarkdownText text={row.text} streaming={false} />
              </div>
            </div>
          )
        }
        if (row.kind === 'assistant') {
          return (
            <div key={`${row.kind}:${row.seq}:${index}`} style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
              <div style={{
                padding: '6px 10px', borderRadius: 10,
                background: 'var(--ds-color-surface-2, #eef2ff)',
                color: 'var(--ds-color-text-1, #1d2129)',
                width: 'fit-content', maxWidth: '100%', fontSize: 13, lineHeight: 1.5,
              }}>
                <MarkdownText text={row.text} streaming={running && index === lastIndex} />
              </div>
            </div>
          )
        }
        if (row.kind === 'tool') {
          return (
            <div key={`${row.kind}:${row.seq}:${index}`} style={{
              color: 'var(--ds-color-text-2, #4e5969)', fontSize: 12,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              🔧 {row.name}{row.failed ? ' ✗' : ''}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

/** The command card is presentation only; the panel host owns live discovery. */
export function SideCommandCard({ node, sessionId, useSessions, readChildTranscript }: SideCommandCardProps): JSX.Element {
  const kind: SideCommandKind = node.name === 'btw' ? 'btw' : 'side'
  const outcome = node.outcome
  const label = outcome === null
    ? '…'
    : outcome.kind === 'error'
      ? (outcome.text ?? '')
      : (outcome.text ?? `/${kind}`)
  const childId = kind === 'btw' ? resolveChildSessionId(node, 'btw') : undefined

  const catalog = useSessions(state => state.subagentsByParent[sessionId])
  const catalogEntry = childId === undefined ? undefined
    : catalog?.entries.find(entry => entry.kind === 'child' && entry.id === childId)
  const childRunning = childId !== undefined && (catalogEntry === undefined || (catalogEntry.kind === 'child' && catalogEntry.activity === 'running'))

  const [rows, setRows] = useState<readonly TranscriptRow[] | null>(null)
  const readRef = useRef(readChildTranscript)
  readRef.current = readChildTranscript
  const pollEpoch = useRef(0)

  // Stream the /btw child transcript in-place. The first fetch is immediate;
  // while the child is running (or the catalog has not placed it yet) a light
  // poll keeps the card token-level live. When the catalog flips to inactive,
  // one final fetch settles the card with the complete transcript.
  useEffect(() => {
    if (childId === undefined) {
      setRows(null)
      return
    }
    const target: SubagentAddress = { parentSessionId: sessionId, childSessionId: childId, mode: 'one-shot' }
    const epoch = ++pollEpoch.current
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const read = () => {
      void readRef.current(target).then((result) => {
        if (cancelled || epoch !== pollEpoch.current) return
        if (result !== null) setRows(result.rows)
      })
    }
    read()
    if (childRunning) {
      timer = setInterval(read, BTW_CARD_POLL_INTERVAL_MS)
    }
    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [childId, sessionId, childRunning])

  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: '8px',
        background: 'var(--ds-color-surface-2, #f2f3f5)',
        fontSize: '13px',
        lineHeight: '1.5',
      }}
    >
      <strong style={{ whiteSpace: 'nowrap', display: 'block', marginBottom: '2px' }}>/{node.name ?? kind}</strong>
      {/* The /btw answer and /side notice render as markdown (tables, code, lists). */}
      <div style={{ overflowX: 'auto' }}>
        <MarkdownText text={label} streaming={false} />
      </div>
      {kind === 'btw' && rows !== null && childRunning
        && !rows.some(row => row.kind === 'assistant' || row.kind === 'reasoning' || row.kind === 'tool') && (
        <div style={{ marginTop: 8, color: 'var(--ds-color-text-2, #4e5969)', fontSize: 12 }}>
          …
        </div>
      )}
      {kind === 'btw' && rows !== null && rows.length > 0 && (
        <BtwTranscript rows={rows} running={childRunning} />
      )}
    </div>
  )
}
