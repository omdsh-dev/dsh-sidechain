/**
 * Sidechain right panel (browser half): a floating right-edge sidebar listing
 * the current session's `/side` and `/btw` subagent children, with an
 * embedded conversation view — selecting a child renders its transcript
 * (and a composer for continuable threads) INSIDE the panel while the main
 * session stays untouched.
 *
 * Panel chrome: the width is drag-resizable from the left edge (rAF-batched
 * direct DOM writes, one store commit on pointer-up, persisted to
 * localStorage, double-click resets), an expand toggle widens it to ~75vw,
 * and Ctrl/Cmd+Shift+E toggles the whole panel. Running rows show a live
 * activity line — the child's latest text or last tool call — polled from a
 * light tail page every 3s while the panel is open and the document visible,
 * with a shimmer sweep on the running label (installed once via
 * panel-style.ts, reduced-motion safe).
 *
 * Data rides the runtime's live subagent catalog — `sessions.list` rows under
 * `subagentsByParent` — for membership, and the catalog's `subagent.history`
 * transcript RPC for conversation content (no activation, no navigation).
 * While the selected child is running, a poll reads its transcript tail (the
 * host serves the live child's in-memory snapshot) and the transcript layer
 * accumulates it with prior rounds, so a `/side` or `/btw` run streams into
 * the panel near-live; the final state lands when the catalog reports the
 * child inactive.
 *
 * The panel deliberately never attaches the child session client-side (no
 * `sessions.binding` / session-face subscription): instantiating a session
 * that is never opened leaves it in the runtime's cold state, whose live
 * event frames are dropped — the transcript would only ever refresh on
 * unrelated state flips — and the extra scope minting interferes with the
 * runtime's session staging. Polling keeps the panel a pure RPC consumer.
 *
 * The visibility + selection store is module-scoped (`panel-state.ts`),
 * shared by the composer-mounted panel host and the header toggle. The host
 * discovers successful live `/side` and `/btw` commands even when blank
 * session chrome suppresses the command cards.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  CommandNode, SessionId, SessionListState, SessionSummary, SubagentAddress,
  SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SubagentCatalog } from '@deepseek-ai/dsh-client-connection/client'
import {
  DisclosureRow, IconBranchOutline16, IconBrowseOutline16, IconChevronLeftOutline14, IconCloseOutline16,
  IconFullscreenOutline16, IconRefreshOutline14, IconRightUpOutline14, MarkdownText, StateDot, TerminalBlock,
  IconThinkOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import {
  clampPanelWidth, closeSidechainPanel, isSidechainPanelOpen, PANEL_DEFAULT_WIDTH,
  readPanelWidth, revealChild, selectChild, selectedChildId, selectedChildMode, subscribeSidechainPanel,
  toggleSidechainPanel, writePanelWidth,
} from './panel-state.ts'
import { observeCreatedChildren, resolveChildSessionId, type ObservedSideCommands } from './SideCommandCard.tsx'
import { fileMentionsFor } from './sidechain-file-mentions.ts'
import { readActivityRound } from './sidechain-activity.ts'
import { blockText, mergeProduced, resultViewSummary } from './sidechain-view.ts'
import type { TranscriptImage, TranscriptRow, ToolDetail } from './sidechain-view.ts'

/** Business actions injected by the slot registration (per session scope). */
export interface SidechainPanelInjected {
  /** Fetch one child's accumulated, seed-cut transcript. */
  readTranscript(address: SubagentAddress): Promise<{
    rows: readonly TranscriptRow[]
    produced: readonly string[]
  } | null>
  /** Fetch one running child's live activity line (light tail page). */
  readActivity(address: SubagentAddress): Promise<string | null>
  /** Deliver one human message to a continuable child. */
  sendPrompt(address: Extract<SubagentAddress, { mode: 'continuable' }>, text: string): Promise<boolean>
  /** Trigger a fresh catalog fetch for the parent session. */
  refresh(parentSessionId: SessionId): void
  /** Arm (true) or disarm (false) the live catalog membership feed. */
  setCatalogOpen(parentSessionId: SessionId, open: boolean): void
  /** Open an absolute path on the host (workspaces.openPath). */
  openPath(path: string): void
}

/** Full props: session standard kit + the inject share + the locale seat. */
export type SidechainPanelProps =
  PropsRuntime<'conversation.input.dock'>
  & SidechainPanelInjected
  & PropsLocale<typeof NS>

/** Header-only panel toggle; the panel host itself lives in the input dock. */
export type SidechainPanelToggleProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>

/** One rendered catalog row, label resolved, diagnostics kept apart. */
export type SidechainRow =
  | {
    kind: 'child'
    id: SessionId
    mode: 'one-shot' | 'continuable'
    activity: 'running' | 'inactive'
    label: string
  }
  | {
    kind: 'diagnostic'
    id: SessionId
    reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/**
 * Resolve the catalog into display rows: child entries carry their host
 * label when present, falling back to the session summary's title, then the
 * session id; diagnostics pass through untouched.
 * @param catalog - the parent's catalog snapshot (absent while never fetched).
 * @param summaries - session list rows, used as the label fallback source.
 * @returns flat display rows in catalog order.
 */
export function sidechainRows(
  catalog: SubagentCatalogSnapshot | undefined,
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): SidechainRow[] {
  if (catalog === undefined) return []
  // 0812's emitted runtime declaration loses the wire catalog fields from
  // SubagentCatalogSnapshot; the runtime value still implements this contract.
  return (catalog as SubagentCatalogSnapshot & SubagentCatalog).entries.map((entry): SidechainRow => {
    if (entry.kind === 'diagnostic') {
      return { kind: 'diagnostic', id: entry.id, reason: entry.reason }
    }
    return {
      kind: 'child',
      id: entry.id,
      mode: entry.mode,
      activity: entry.activity,
      label: entry.label ?? summaries[entry.id]?.title ?? entry.id,
    }
  })
}

/** Number of child rows currently running (the header badge value). */
export function runningCount(rows: readonly SidechainRow[]): number {
  return rows.filter(row => row.kind === 'child' && row.activity === 'running').length
}

/** Localized diagnostic copy, explicit key cases keep the dictionary typed. */
export function diagnosticText(
  reason: 'corrupt' | 'unsupported' | 'unavailable',
  t: SidechainPanelProps['t'],
): string {
  switch (reason) {
    case 'corrupt': return t('diagnostic.corrupt')
    case 'unsupported': return t('diagnostic.unsupported')
    case 'unavailable': return t('diagnostic.unavailable')
  }
}

/** Shared token-level palette (falls back gracefully when the app lacks the variables). */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const C = {
  text1: 'var(--ds-color-text-1, #1d2129)',
  text2: 'var(--ds-color-text-2, #4e5969)',
  surface2: 'var(--ds-color-surface-2, #f2f3f5)',
  hover: 'var(--ds-color-hover, rgba(0, 0, 0, 0.06))',
  border: 'var(--ds-color-border-1, rgba(0, 0, 0, 0.12))',
  primary: 'var(--ds-color-primary, #3370ff)',
  danger: 'var(--ds-color-danger, #f53f3f)',
} as const

/** Side panel enter/exit animation duration (ms). */
const PANEL_TRANSITION_MS = 240

const styles: Record<string, CSSProperties> = {
  toggle: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 6px', border: 'none', borderRadius: 6,
    background: 'transparent', color: C.text2, cursor: 'pointer',
    fontSize: 13, lineHeight: 1,
  },
  toggleActive: {
    background: C.surface2, color: C.text1,
  },
  badge: {
    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
    background: C.primary, color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center',
  },
  panel: {
    position: 'fixed', top: 0, right: 0, bottom: 0, width: 360, maxWidth: '92vw',
    display: 'flex', flexDirection: 'column',
    background: 'var(--ds-color-bg-1, #ffffff)', borderLeft: `1px solid ${C.border}`,
    boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.12)', zIndex: 200,
    fontSize: 13, color: C.text1,
    transition: `transform ${PANEL_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${PANEL_TRANSITION_MS}ms ease`,
  },
  resizer: {
    position: 'absolute', top: 0, bottom: 0, left: -6, width: 12,
    cursor: 'col-resize', touchAction: 'none', zIndex: 2,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderBottom: `1px solid ${C.border}`,
  },
  title: { flex: 1, fontWeight: 600, fontSize: 14 },
  back: {
    display: 'inline-flex', alignItems: 'center', gap: 2,
    padding: '2px 4px', border: 'none', borderRadius: 6,
    background: 'transparent', color: C.text2, cursor: 'pointer', fontSize: 12,
    flex: 1, textAlign: 'left',
  },
  runningCount: { color: C.text2, fontSize: 12 },
  iconButton: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, padding: 0, border: 'none', borderRadius: 6,
    background: 'transparent', color: C.text2, cursor: 'pointer',
  },
  body: { flex: 1, overflowY: 'auto', padding: 6 },
  notice: { padding: '16px 12px', color: C.text2, textAlign: 'center' },
  error: { display: 'flex', alignItems: 'center', gap: 8, padding: 12, color: C.danger },
  retry: {
    padding: '2px 8px', border: `1px solid ${C.border}`, borderRadius: 6,
    background: 'transparent', color: C.text2, cursor: 'pointer', fontSize: 12,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
    width: '100%', border: 'none', background: 'transparent', color: 'inherit',
    fontSize: 13, textAlign: 'left',
  },
  rowDisabled: { cursor: 'default', opacity: 0.6 },
  content: { flex: 1, minWidth: 0 },
  label: {
    display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  summary: {
    display: 'block', color: C.text2, fontSize: 12,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  activityLine: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    color: C.text2, fontSize: 12, lineHeight: 1.4,
    wordBreak: 'break-word', textAlign: 'left',
  },
  transcript: { flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 },
  userRow: { alignSelf: 'flex-start', maxWidth: '100%' },
  imageRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  image: {
    display: 'block', width: 'min(100%, 280px)', maxHeight: 240, objectFit: 'contain',
    borderRadius: 6, border: '1px solid var(--ds-color-border, #d7dce3)', background: C.surface2,
  },
  userText: {
    padding: '6px 10px', borderRadius: 10,
    background: 'var(--ds-color-bg-2, #f2f3f5)', color: C.text1,
    width: 'fit-content', maxWidth: '100%', fontSize: 13, lineHeight: 1.5,
  },
  assistantRow: { alignSelf: 'flex-start', maxWidth: '100%' },
  assistantText: {
    padding: '6px 10px', borderRadius: 10,
    background: 'var(--ds-color-surface-2, #eef2ff)', color: C.text1,
    width: 'fit-content', maxWidth: '100%', fontSize: 13, lineHeight: 1.5,
  },
  disclosureSummary: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: C.text2,
  },
  disclosureSeparator: {
    flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1,
    background: 'var(--ds-color-text-3, #9ca3af)',
  },
  disclosureBody: {
    margin: '4px 0 4px 22px', padding: '8px 10px', maxHeight: 240, overflow: 'auto',
    borderRadius: 6, background: 'var(--ds-color-bg-2, #f2f3f5)', color: C.text2,
    fontFamily: MONO, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
  },
  toolRow: { color: C.text2, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  toolFailed: { color: C.danger },
  toolDetail: { padding: '4px 0 6px' },
  toolArgs: {
    margin: '4px 0', padding: '6px 8px', borderRadius: 6,
    background: 'var(--ds-color-bg-2, #f2f3f5)', fontFamily: MONO,
    fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    maxHeight: 180, overflowY: 'auto',
  },
  composer: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderTop: `1px solid ${C.border}`,
  },
  input: {
    flex: 1, minWidth: 0, padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 8,
    background: 'var(--ds-color-bg-1, #ffffff)', color: C.text1, fontSize: 13, outline: 'none',
  },
  sendButton: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, padding: 0, border: 'none', borderRadius: 8,
    background: C.primary, color: '#fff', cursor: 'pointer',
  },
  readonly: {
    padding: '8px 12px', borderTop: `1px solid ${C.border}`,
    color: C.text2, fontSize: 12, textAlign: 'center',
  },
}

/** Render one catalog row; clicking selects it for the embedded view.
 *  Running rows carry a live activity line (latest text / tool call) under
 *  the mode summary — polled separately and only while the panel is open. */
function Row({ row, activityText, t, onSelect }: {
  row: SidechainRow
  activityText: string | undefined
  t: SidechainPanelProps['t']
  onSelect: (childSessionId: SessionId) => void
}): JSX.Element {
  if (row.kind === 'diagnostic') {
    const reason = diagnosticText(row.reason, t)
    return (
      <div style={{ ...styles.row, ...styles.rowDisabled }} title={reason} aria-disabled="true">
        <StateDot state="error" />
        <span style={styles.content}>
          <span style={styles.label}>{row.id}</span>
          <span style={styles.summary}>{reason}</span>
        </span>
      </div>
    )
  }
  const mode = row.mode === 'one-shot' ? t('mode.oneShot') : t('mode.continuable')
  const running = row.activity === 'running'
  const activity = running ? t('activity.running') : t('activity.inactive')
  return (
    <button
      type="button"
      style={styles.row}
      title={t('row.open', { label: row.label })}
      aria-label={t('row.open', { label: row.label })}
      onClick={() => onSelect(row.id)}
    >
      <StateDot state={running ? 'ongoing' : 'done'} />
      <span style={styles.content}>
        <span style={styles.label}>{row.label}</span>
        <span style={styles.summary}>
          {`${mode} · `}
          {running
            ? <span className="dsh-sidechain-shimmer">{activity}</span>
            : activity}
        </span>
        {activityText !== undefined && (
          <span style={styles.activityLine} title={activityText}>{activityText}</span>
        )}
      </span>
    </button>
  )
}

/** Cap for raw arguments shown in the detail view (platform contract: never
 *  dump full raw arguments — write/edit payloads can be hundreds of KB). */
const TOOL_ARGS_MAX = 2000

/** Pretty-print a tool's curated rawInput (the platform contract's salient
 *  input), falling back to the raw arguments JSON truncated to a hard cap. */
function prettyToolInput(rawInput: unknown, argumentsRaw: string | undefined): string | undefined {
  if (rawInput !== undefined) {
    try {
      return JSON.stringify(rawInput, null, 2)
    } catch {
      // non-serializable rawInput: fall through to the arguments fallback
    }
  }
  if (argumentsRaw === undefined) return undefined
  const trimmed = argumentsRaw.length > TOOL_ARGS_MAX
    ? `${argumentsRaw.slice(0, TOOL_ARGS_MAX)}…（已截断）`
    : argumentsRaw
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

/** Platform convention: decorative animations yield to prefers-reduced-motion
 *  (the plugin bundle has no CSS pipeline, so the guard is a JS matchMedia). */
function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** One expandable tool row: collapsed shows the call line; expanded shows
 *  the terminal-style command/output (terminal calls) or the arguments,
 *  result text, and failure detail. */
function ToolRow({ row, running, codeLabels }: {
  row: Extract<TranscriptRow, { kind: 'tool' }>
  /** The child session is still running and this call has no result yet. */
  running: boolean
  codeLabels: MarkdownCodeLabels | undefined
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const detail: ToolDetail | undefined = row.detail
  const callView = detail?.callView
  const resultView = detail?.resultView
  const terminal = callView?.card === 'terminal' || resultView?.card === 'terminal'
  const resultText = resultView === undefined || resultView.card === 'terminal'
    ? undefined
    : resultViewSummary(resultView)
  const inputText = prettyToolInput(
    callView !== undefined && callView.card === 'generic' ? callView.rawInput : undefined,
    detail?.arguments,
  )
  const expandable = detail !== undefined && (
    terminal
    || inputText !== undefined
    || resultText !== undefined
    || detail.error !== undefined
  )
  const title = callView !== undefined && callView.card !== 'terminal' ? callView.title : row.name
  return (
    <DisclosureRow
      icon={<StateDot state={row.failed ? 'error' : running ? 'ongoing' : 'done'} />}
      title={title}
      open={open}
      expandable={expandable}
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={row.failed ? ' ✗' : undefined}
    >
      <div style={styles.toolDetail}>
        {terminal && callView?.card === 'terminal' ? (
          <TerminalBlock
            command={callView.title}
            cwd={callView.cwd}
            output={resultView !== undefined && resultView.card === 'terminal' ? resultView.output : undefined}
            exitCode={resultView !== undefined && resultView.card === 'terminal' ? resultView.exitCode : undefined}
            signal={resultView !== undefined && resultView.card === 'terminal' ? resultView.signal : undefined}
            running={running}
            maxLines={24}
          />
        ) : (
          <>
            {inputText !== undefined && (
              <pre style={styles.toolArgs}>{inputText}</pre>
            )}
            {resultText !== undefined && (
              <div style={{ margin: '4px 0' }}>
                <MarkdownText text={resultText} streaming={false} codeLabels={codeLabels} />
              </div>
            )}
          </>
        )}
        {detail?.error !== undefined && (
          <div style={{ ...styles.toolFailed, fontSize: 12, marginTop: 4 }}>
            {`✗ ${detail.error.name}: ${detail.error.code}`}
          </div>
        )}
      </div>
    </DisclosureRow>
  )
}

/** Compact disclosure matching the main conversation's Think/context rows. */
function TranscriptDisclosure({ row, streaming, t }: {
  row: Extract<TranscriptRow, { kind: 'reasoning' | 'context' }>
  streaming: boolean
  t: SidechainPanelProps['t']
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = row.text.trim().split('\n').find(line => line !== '') ?? ''
  const contextSource = row.kind === 'context' ? row.source : null
  return (
    <DisclosureRow
      icon={row.kind === 'reasoning' ? <IconThinkOutline14 /> : <IconBrowseOutline16 size={14} />}
      title={row.kind === 'reasoning'
        ? t('view.reasoning')
        : t(row.recall ? 'view.contextRecall' : 'view.context')}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={(
        <>
          <span style={styles.disclosureSeparator} aria-hidden />
          <span style={styles.disclosureSummary}>
            {contextSource ?? (streaming ? summary.slice(-120) : summary)}
          </span>
        </>
      )}
    >
      <pre style={styles.disclosureBody}>{row.text}</pre>
    </DisclosureRow>
  )
}

function TranscriptImages({ images }: {
  images: readonly TranscriptImage[]
}): JSX.Element | null {
  const visible = images.filter(image => image.url !== undefined)
  if (visible.length === 0) return null
  return (
    <div style={styles.imageRow}>
      {visible.map(image => (
        <img
          key={String(image.attachment.attachmentId)}
          src={image.url}
          alt={image.attachment.name ?? 'Attached image'}
          style={styles.image}
        />
      ))}
    </div>
  )
}

/** One transcript row from the child session's full visible timeline. */
function TranscriptRowView({ row, streaming, codeLabels, fileMentions, t }: {
  row: TranscriptRow
  streaming: boolean
  codeLabels: MarkdownCodeLabels | undefined
  fileMentions: MarkdownFileMentions | undefined
  t: SidechainPanelProps['t']
}): JSX.Element {
  if (row.kind === 'user') {
    return (
      <div style={styles.userRow}>
        {row.images !== undefined && <TranscriptImages images={row.images} />}
        {row.text !== '' && <div style={styles.userText}>
          <MarkdownText text={row.text} streaming={streaming} codeLabels={codeLabels} fileMentions={fileMentions} />
        </div>}
      </div>
    )
  }
  if (row.kind === 'assistant') {
    return (
      <div style={styles.assistantRow}>
        {row.images !== undefined && <TranscriptImages images={row.images} />}
        {row.text !== '' && <div style={styles.assistantText}>
          <MarkdownText text={row.text} streaming={streaming} codeLabels={codeLabels} fileMentions={fileMentions} />
        </div>}
      </div>
    )
  }
  if (row.kind === 'reasoning' || row.kind === 'context') {
    return <>
      {row.kind === 'context' && row.images !== undefined && <TranscriptImages images={row.images} />}
      {row.text !== '' && <TranscriptDisclosure row={row} streaming={streaming} t={t} />}
    </>
  }
  return <ToolRow row={row} running={streaming && row.detail?.resultView === undefined} codeLabels={codeLabels} />
}

/** Poll interval for the selected child's transcript while it is running (ms). */
const LIVE_POLL_INTERVAL_MS = 1200
/** Poll interval for running rows' activity lines (ms). */
const ACTIVITY_POLL_INTERVAL_MS = 3000

/**
 * Header action for manually opening the sidechain catalog. Keeping this
 * separate from the panel host lets blank sessions mount the host even while
 * their header chrome is intentionally absent.
 */
export function SidechainPanelToggle({ sessionId, useSessions, t }: SidechainPanelToggleProps): JSX.Element {
  const [open, setOpen] = useState(isSidechainPanelOpen)
  useEffect(() => subscribeSidechainPanel(() => { setOpen(isSidechainPanelOpen()) }), [])
  const catalog = useSessions(state => state.subagentsByParent[sessionId])
  const summaries = useSessions(state => state.byId)
  const running = runningCount(sidechainRows(catalog, summaries))
  return (
    <button
      type="button"
      style={{ ...styles.toggle, ...(open ? styles.toggleActive : {}) }}
      title={t('panel.toggle')}
      aria-label={t('panel.toggle')}
      aria-pressed={open}
      onClick={toggleSidechainPanel}
    >
      <IconBranchOutline16 />
      {running > 0 && <span style={styles.badge}>{running}</span>}
    </button>
  )
}

/**
 * The composer-mounted floating right panel. It shows the catalog list or,
 * once selected, the child's embedded conversation (transcript + composer for continuable
 * threads); the main session never switches. Arming the catalog happens on
 * open and follows the current session.
 */
export function SidechainPanel({
  sessionId, useSession, useSessions, readTranscript, readActivity, sendPrompt, refresh, setCatalogOpen, openPath, t,
}: SidechainPanelProps): JSX.Element {
  const [open, setOpen] = useState(isSidechainPanelOpen)
  const [selected, setSelected] = useState(selectedChildId)
  const [selectedMode, setSelectedMode] = useState(selectedChildMode)
  useEffect(() => subscribeSidechainPanel(() => {
    setOpen(isSidechainPanelOpen())
    setSelected(selectedChildId())
    setSelectedMode(selectedChildMode())
  }), [])

  // Enter/exit animation: keep the panel mounted through its exit transition,
  // then unmount only after the slide-out finishes.
  const [mounted, setMounted] = useState(isSidechainPanelOpen)
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
    } else {
      setEntered(false)
      const timer = setTimeout(() => setMounted(false), PANEL_TRANSITION_MS)
      return () => clearTimeout(timer)
    }
  }, [open])
  useEffect(() => {
    if (!mounted || !open) return
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [mounted, open])

  // This host remains mounted in the blank-session composer, where command
  // rows and the header do not exist. Seed replayed commands, then reveal only
  // children created or settled after this session observer mounted.
  const chatNodes = useSession(snapshot => snapshot.chat.nodes.values())
  const commands = useMemo(() => (chatNodes as readonly ChatNode[])
    .filter((node): node is ChatNode<'command'> => node.kind === 'command')
    .map((node): CommandNode => node.data), [chatNodes])
  const observedRef = useRef<{
    sessionId: SessionId
    startedAt: number
    known: ObservedSideCommands | undefined
  }>({
    sessionId,
    startedAt: Date.now(),
    known: undefined,
  })
  useEffect(() => {
    if (observedRef.current.sessionId !== sessionId) {
      observedRef.current = { sessionId, startedAt: Date.now(), known: undefined }
    }
    const observed = observeCreatedChildren(
      observedRef.current.known,
      commands,
      observedRef.current.startedAt,
    )
    observedRef.current.known = observed.known
    for (const child of observed.children) {
      // The command's own kind tells us the child's mode even before the
      // catalog has placed it — so the panel can start reading the child
      // immediately instead of waiting for a manual refresh.
      const owner = commands.find(candidate => {
        const name = candidate.name
        return (name === 'side' || name === 'btw')
          && resolveChildSessionId(candidate, name) === child
      })
      const mode = owner !== undefined
        ? (owner.name === 'btw' ? 'one-shot' : 'continuable')
        : undefined
      revealChild(child, mode)
    }
  }, [commands, sessionId])

  const catalogs = useSessions(state => state.subagentsByParent)
  const summaries = useSessions(state => state.byId)
  const catalog = catalogs[sessionId]
  const rows = useMemo(() => sidechainRows(catalog, summaries), [catalog, summaries])
  const running = runningCount(rows)
  // Stable reference: MarkdownText bakes codeLabels into its streaming cache
  // and discards the cache when the reference changes (see its module doc).
  const codeLabels = useMemo(() => ({ copyLabel: t('code.copy'), copiedLabel: t('code.copied') }), [t])

  // The injected actions can be recreated per render; keep effects pinned to
  // stable keys, reading the latest actions through a ref.
  const actionsRef = useRef({ readTranscript, readActivity, sendPrompt, refresh, setCatalogOpen })
  actionsRef.current = { readTranscript, readActivity, sendPrompt, refresh, setCatalogOpen }

  // Arm the catalog feed and refresh while open; disarm on close or when the
  // panel moves to another session (the cleanup runs with the old session id).
  useEffect(() => {
    if (!open) return
    const { refresh, setCatalogOpen } = actionsRef.current
    setCatalogOpen(sessionId, true)
    refresh(sessionId)
    return () => { actionsRef.current.setCatalogOpen(sessionId, false) }
  }, [open, sessionId])

  // Keep the catalog live even if the runtime's automatic subagent events do
  // not arrive: while the panel is open, periodically refresh so finished
  // children disappear and freshly created /btw entries appear in the list.
  const CATALOG_REFRESH_INTERVAL_MS = 5000
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => {
      actionsRef.current.refresh(sessionId)
    }, CATALOG_REFRESH_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [open, sessionId])

  // ---- Panel width: drag-to-resize (rAF-batched direct DOM writes, one
  // store commit on pointer-up), double-click reset, expand toggle, all
  // clamped and persisted. The panel element's style is written directly
  // while dragging so the streaming transcript never re-renders per frame. ----
  const [width, setWidth] = useState(() => readPanelWidth() ?? PANEL_DEFAULT_WIDTH)
  const [expanded, setExpanded] = useState(false)
  const panelRef = useRef<HTMLElement | null>(null)
  const widthRef = useRef(width)
  widthRef.current = width
  /** Pre-expand width, restored when the expand toggle switches back. */
  const expandedRef = useRef<number | null>(null)
  const dragRef = useRef<{ startX: number; startWidth: number; raf: number | null; pending: number } | null>(null)

  const applyDragWidth = useCallback((value: number) => {
    panelRef.current?.style.setProperty('width', `${value}px`)
  }, [])
  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    expandedRef.current = null
    const startWidth = panelRef.current?.getBoundingClientRect().width ?? widthRef.current
    dragRef.current = { startX: event.clientX, startWidth, raf: null, pending: startWidth }
  }, [])
  const onResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null) return
    drag.pending = clampPanelWidth(drag.startWidth + drag.startX - event.clientX, window.innerWidth)
    if (drag.raf === null) {
      drag.raf = requestAnimationFrame(() => {
        drag.raf = null
        applyDragWidth(drag.pending)
      })
    }
  }, [applyDragWidth])
  const onResizePointerUp = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag === null) return
    if (drag.raf !== null) {
      cancelAnimationFrame(drag.raf)
      applyDragWidth(drag.pending)
    }
    widthRef.current = drag.pending
    setWidth(drag.pending)
    writePanelWidth(drag.pending)
  }, [applyDragWidth])
  const onResizeDoubleClick = useCallback(() => {
    expandedRef.current = null
    widthRef.current = PANEL_DEFAULT_WIDTH
    setWidth(PANEL_DEFAULT_WIDTH)
    setExpanded(false)
    writePanelWidth(PANEL_DEFAULT_WIDTH)
  }, [])
  const toggleExpanded = useCallback(() => {
    if (expandedRef.current !== null) {
      const back = expandedRef.current
      expandedRef.current = null
      widthRef.current = back
      setWidth(back)
      setExpanded(false)
      writePanelWidth(back)
    } else {
      expandedRef.current = widthRef.current
      const wide = Math.max(PANEL_DEFAULT_WIDTH, Math.floor(window.innerWidth * 0.75))
      widthRef.current = wide
      setWidth(wide)
      setExpanded(true)
    }
  }, [])
  // Unmount mid-drag must not leak a pending animation frame.
  useEffect(() => () => {
    const drag = dragRef.current
    if (drag !== null && drag.raf !== null) cancelAnimationFrame(drag.raf)
  }, [])

  // Keyboard shortcut: Ctrl/Cmd+Shift+E toggles the panel (same gesture family
  // as the host's command palette; no default browser action is shadowed).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        toggleSidechainPanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])

  // The selected child's durable address (stable while selection/catalog stay).
  // Prefer the catalog's authoritative mode; when the catalog has not yet
  // placed the freshly-created child, fall back to the mode we learned from
  // its `/side` or `/btw` command so the panel can stream immediately.
  const address = useMemo<SubagentAddress | undefined>(() => {
    if (selected === undefined) return undefined
    const row = rows.find(candidate => candidate.kind === 'child' && candidate.id === selected)
    const mode = row?.kind === 'child' ? row.mode : selectedMode
    return mode === undefined
      ? undefined
      : { parentSessionId: sessionId, childSessionId: selected, mode }
  }, [selected, rows, selectedMode, sessionId])

  // The selected child's catalog row (its activity drives the live poll).
  const selectedRow = selected === undefined
    ? undefined
    : rows.find(candidate => candidate.id === selected)
  const selectedChild = selectedRow !== undefined && selectedRow.kind === 'child' ? selectedRow : undefined
  // Prefer the session summary's running bit; it is updated by host frames and
  // is more reliable than the catalog, which may lag until a manual refresh.
  // A child we just created via /btw or /side may not have appeared in the
  // catalog yet; treat it as running so the live poll and waiting hint engage
  // until the summary/catalog catches up.
  const summaryRunning = selected === undefined ? undefined : summaries[selected]?.running
  const selectedRunning = selectedChild !== undefined
    ? (summaryRunning ?? selectedChild.activity === 'running')
    : (summaryRunning ?? (selectedMode !== undefined))

  // Stable key for the selected address (primitive — never churns with
  // unrelated list re-renders), plus refs the persistent poll reads.
  const addressKey = address === undefined
    ? undefined
    : `${address.parentSessionId}:${address.childSessionId}:${address.mode}`
  const addressRef = useRef(address)
  addressRef.current = address
  const openRef = useRef(open)
  openRef.current = open
  const runningRef = useRef(selectedRunning)
  runningRef.current = selectedRunning

  // Transcript fetch state; an epoch guard makes stale responses no-ops.
  const [transcript, setTranscript] = useState<readonly TranscriptRow[] | null>(null)
  const [produced, setProduced] = useState<readonly string[]>([])
  // File-mention vocabulary: files the selected child's tool calls produced,
  // resolved against the child's cwd (the main chat's ui-deliverables policy).
  const childCwd = selected === undefined ? undefined : summaries[selected]?.cwd
  const fileMentions = useMemo(
    () => fileMentionsFor(produced, childCwd, openPath),
    [produced, childCwd, openPath],
  )
  const [transcriptState, setTranscriptState] = useState<'loading' | 'ready' | 'error'>('loading')
  const fetchEpoch = useRef(0)
  // Single-flight guard: a poll tick while a fetch is still in flight is
  // skipped (the poll interval is shorter than heavy first reads; piling up
  // overlapping transcript requests would starve the server).
  const fetchInFlight = useRef(false)
  const request = useCallback((target: SubagentAddress, showLoading: boolean) => {
    if (fetchInFlight.current && !showLoading) return
    const epoch = ++fetchEpoch.current
    if (showLoading) setTranscriptState('loading')
    fetchInFlight.current = true
    void actionsRef.current.readTranscript(target).then((result) => {
      fetchInFlight.current = false
      if (epoch !== fetchEpoch.current) return
      setTranscript(result?.rows ?? null)
      // An initial fetch replaces the vocabulary; later polls union it, so
      // produced paths whose rows slid out of the tail window keep working.
      setProduced(previous => showLoading
        ? (result?.produced ?? [])
        : mergeProduced(previous, result?.produced ?? []))
      setTranscriptState(result === null ? 'error' : 'ready')
    })
  }, [])

  // Initial fetch whenever the selection or the session changes.
  useEffect(() => {
    if (!open) return
    const target = addressRef.current
    if (target !== undefined) request(target, true)
  }, [open, addressKey, request])

  // Persistent live poll: one interval for the component's lifetime, reading
  // the current address/running state through refs — unrelated list renders
  // must never reset it (a resetting interval could starve the polls while
  // frames churn the list store).
  useEffect(() => {
    const timer = setInterval(() => {
      if (!openRef.current || !runningRef.current) return
      const target = addressRef.current
      if (target !== undefined) request(target, false)
    }, LIVE_POLL_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [request])

  // ---- Running rows' activity lines: a light tail poll per running child
  // (6-message pages, 3s cadence), only while the panel is open and the
  // document visible. Per-child epochs discard stale responses; entries are
  // pruned when their child stops running. ----
  const runningRows = useMemo(
    () => rows.filter((row): row is Extract<SidechainRow, { kind: 'child' }> =>
      row.kind === 'child' && row.activity === 'running'),
    [rows],
  )
  const runningIds = useMemo(() => runningRows.map(row => row.id), [runningRows])
  const runningIdsRef = useRef(runningIds)
  runningIdsRef.current = runningIds
  const runningRowsRef = useRef(runningRows)
  runningRowsRef.current = runningRows
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const [activity, setActivity] = useState<Readonly<Record<SessionId, string>>>({})
  const activityEpoch = useRef(new Map<string, number>())
  // Single-flight guard for the whole activity round (one round may fan out
  // to several running children; a slow round must not overlap itself).
  const activityInFlight = useRef(false)
  const pollActivity = useCallback(() => {
    if (!openRef.current || document.hidden) return
    const targets = runningRowsRef.current
    if (targets.length === 0) return
    if (activityInFlight.current) return
    const { readActivity } = actionsRef.current
    activityInFlight.current = true
    const round = targets.map(row => {
      const epoch = (activityEpoch.current.get(row.id) ?? 0) + 1
      activityEpoch.current.set(row.id, epoch)
      return { row, epoch }
    })
    void readActivityRound(round, ({ row }) => readActivity({
      parentSessionId: sessionIdRef.current,
      childSessionId: row.id,
      mode: row.mode,
    }), ({ row, epoch }, line) => {
      if (activityEpoch.current.get(row.id) === epoch) {
        setActivity(previous => previous[row.id] === line ? previous : { ...previous, [row.id]: line })
      }
    }).finally(() => { activityInFlight.current = false })
  }, [])
  useEffect(() => {
    const timer = setInterval(() => { pollActivity() }, ACTIVITY_POLL_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [pollActivity])
  // Immediate catch-up whenever the panel opens or the running set changes
  // (catalog flip), then the interval owns the cadence.
  useEffect(() => {
    if (open) pollActivity()
  }, [open, runningIds, pollActivity])
  // A child that stopped running drops out of the preview map.
  useEffect(() => {
    setActivity((previous) => {
      const active = new Set(runningIds)
      const keys = Object.keys(previous) as SessionId[]
      if (keys.length === runningIds.length && keys.every(key => active.has(key))) return previous
      const next: Record<SessionId, string> = {}
      for (const key of keys) {
        if (active.has(key) && previous[key] !== undefined) next[key] = previous[key]
      }
      return next
    })
  }, [runningIds])

  // On the running → inactive transition (the catalog activity flip): pull
  // the settled transcript exactly, and mark the finalize swap — the rows
  // switch from streaming to settled rendering (syntax highlighting, KaTeX,
  // file mentions land) — with a brief fade via the Web Animations API.
  // The guard records the child identity: switching to another child must
  // reset it, so a long-finished child never replays the previous child's
  // settle transition.
  const settleGuard = useRef<{ id: SessionId | undefined; running: boolean } | undefined>(undefined)
  useEffect(() => {
    if (selectedChild === undefined) {
      settleGuard.current = undefined
      return
    }
    const previous = settleGuard.current
    settleGuard.current = { id: selectedChild.id, running: selectedRunning }
    if (previous === undefined || previous.id !== selectedChild.id) return
    if (previous.running === true && !selectedRunning) {
      const target = addressRef.current
      if (target !== undefined) request(target, false)
      const el = transcriptRef.current
      if (el !== null && !prefersReducedMotion()) {
        el.animate(
          [{ opacity: 0.7 }, { opacity: 1 }],
          { duration: 260, easing: 'ease-out' },
        )
      }
    }
  }, [selectedChild, selectedRunning, request])

  // Keep the newest content in view while a run streams — but only when the
  // reader is already near the bottom, so scrolling up to re-read is stable.
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  const onTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current
    if (el === null) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])
  useEffect(() => {
    const el = transcriptRef.current
    if (el !== null && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [transcript])

  // Composer state for continuable children.
  const [draft, setDraft] = useState('')
  const [sendFailed, setSendFailed] = useState(false)
  // Send epoch: a prompt already in flight must never update the composer
  // after a newer send (or unmount) — the same staleness guard the polls use.
  const sendEpoch = useRef(0)
  const send = useCallback(async () => {
    const target = addressRef.current
    if (target === undefined || target.mode !== 'continuable') return
    const text = draft.trim()
    if (text === '') return
    setSendFailed(false)
    const epoch = ++sendEpoch.current
    const ok = await actionsRef.current.sendPrompt(
      { parentSessionId: target.parentSessionId, childSessionId: target.childSessionId, mode: 'continuable' },
      text,
    )
    if (epoch !== sendEpoch.current) return
    if (!ok) {
      // A rejected send must not eat the user's typing — restore the draft.
      setSendFailed(true)
      setDraft(text)
      return
    }
    setDraft('')
    request(target, false)
  }, [draft, request])

  const loading = catalog === undefined
    || (catalog.state === 'loading' && rows.length === 0)
  const empty = catalog !== undefined && catalog.state === 'ready' && rows.length === 0

  const panelTransform = entered ? 'translateX(0)' : 'translateX(100%)'
  const panelOpacity = entered ? 1 : 0
  return (
    <>
      {mounted && (
        <aside
          ref={panelRef}
          style={{ ...styles.panel, width, transform: panelTransform, opacity: panelOpacity }}
          role="complementary"
          aria-label={t('panel.title')}
        >
          <div
            style={styles.resizer}
            title={t('panel.resize')}
            role="separator"
            aria-orientation="vertical"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onDoubleClick={onResizeDoubleClick}
          />
          <div style={styles.header}>
            {address === undefined ? (
              <span style={styles.title}>{t('panel.title')}</span>
            ) : (
              <button
                type="button"
                style={styles.back}
                title={t('view.back')}
                onClick={() => { actionsRef.current.refresh(sessionId); selectChild(undefined) }}
              >
                <IconChevronLeftOutline14 />
                {t('view.back')}
              </button>
            )}
            {address === undefined && running > 0 && (
              <span style={styles.runningCount}>{t('count.running', { count: running })}</span>
            )}
            <button
              type="button"
              style={styles.iconButton}
              title={expanded ? t('panel.contract') : t('panel.expand')}
              aria-label={expanded ? t('panel.contract') : t('panel.expand')}
              aria-pressed={expanded}
              onClick={toggleExpanded}
            >
              <IconFullscreenOutline16 />
            </button>
            <button
              type="button"
              style={styles.iconButton}
              title={t('panel.refresh')}
              aria-label={t('panel.refresh')}
              onClick={() => {
                if (address === undefined) actionsRef.current.refresh(sessionId)
                else {
                  const target = addressRef.current
                  if (target !== undefined) request(target, true)
                }
              }}
            >
              <IconRefreshOutline14 />
            </button>
            <button
              type="button"
              style={styles.iconButton}
              title={t('panel.close')}
              aria-label={t('panel.close')}
              onClick={closeSidechainPanel}
            >
              <IconCloseOutline16 />
            </button>
          </div>
          {address === undefined ? (
            <div style={styles.body}>
              {catalog !== undefined && catalog.state === 'error' && (
                <div style={styles.error}>
                  <span>{t('panel.error')}</span>
                  <button
                    type="button"
                    style={styles.retry}
                    onClick={() => { actionsRef.current.refresh(sessionId) }}
                  >
                    {t('panel.retry')}
                  </button>
                </div>
              )}
              {loading && <div style={styles.notice}>{t('panel.loading')}</div>}
              {empty && <div style={styles.notice}>{t('panel.empty')}</div>}
              {rows.map(row => (
                <Row
                  key={row.id}
                  row={row}
                  activityText={
                    row.kind === 'child' && row.activity === 'running' ? activity[row.id] : undefined
                  }
                  t={t}
                  onSelect={(childSessionId) => { selectChild(childSessionId) }}
                />
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div ref={transcriptRef} style={styles.transcript} onScroll={onTranscriptScroll}>
                {!selectedRunning && transcriptState === 'loading' && <div style={styles.notice}>{t('view.loading')}</div>}
                {transcriptState === 'error' && (
                  <div style={styles.error}>
                    <span>{t('view.error')}</span>
                    <button
                      type="button"
                      style={styles.retry}
                      onClick={() => {
                        const target = addressRef.current
                        if (target !== undefined) request(target, true)
                      }}
                    >
                      {t('panel.retry')}
                    </button>
                  </div>
                )}
                {transcriptState === 'ready' && transcript !== null && transcript.length === 0 && !selectedRunning && (
                  <div style={styles.notice}>{t('view.empty')}</div>
                )}
                {(transcript ?? []).map((row, index, all) => (
                  <TranscriptRowView
                    key={`${row.kind}:${row.seq}:${index}`}
                    row={row}
                    streaming={selectedRunning && index === all.length - 1}
                    codeLabels={codeLabels}
                    fileMentions={fileMentions}
                    t={t}
                  />
                ))}
                {/* Bottom-left waiting hint, DeepSeek blue, present while the
                    child is running (i18n-driven copy via view.waiting). */}
                {selectedRunning && (
                  <div style={{
                    marginTop: 8,
                    color: 'var(--ds-color-primary, #4D6BFE)',
                    textAlign: 'left',
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}>{t('view.waiting')}</div>
                )}
              </div>
              {address.mode === 'one-shot' ? (
                <div style={styles.readonly}>{t('view.readonly')}</div>
              ) : (
                <form
                  style={styles.composer}
                  onSubmit={(event) => {
                    event.preventDefault()
                    void send()
                  }}
                >
                  <input
                    style={styles.input}
                    value={draft}
                    placeholder={t('composer.placeholder')}
                    aria-label={t('composer.sendAria')}
                    onChange={(event) => { setDraft(event.target.value) }}
                  />
                  <button type="submit" style={styles.sendButton} aria-label={t('composer.send')}>
                    <IconRightUpOutline14 />
                  </button>
                </form>
              )}
              {sendFailed && <div style={styles.error}>{t('view.sendFailed')}</div>}
            </div>
          )}
        </aside>
      )}
    </>
  )
}
