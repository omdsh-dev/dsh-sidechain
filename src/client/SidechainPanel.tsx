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
 * Data rides the alpha Session Controller's live subagent catalog —
 * `sessions.list` rows under `projectionsBySession` — for membership, and Session
 * Remote history for conversation content (no activation, no navigation).
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
import { createPortal } from 'react-dom'
import type {
  CommandNode, ChatNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  SessionListState, SessionSummary, SessionProjectionSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {} from '../sidechain-projection.ts'
import type { SideMode } from '../prompts.ts'
import {
  DisclosureRow, IconBranchOutlineRegular, IconBrowseOutlineRegular, IconChevronLeftOutlineRegular, IconCloseOutlineRegular,
  IconFullscreenOutlineRegular, IconRefreshOutlineRegular, IconRightUpOutlineRegular, MarkdownText, StateDot,
  IconThinkOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import {
  clampPanelWidth, closeSidechainPanel, isSidechainPanelOpen, PANEL_DEFAULT_WIDTH,
  readPanelWidth, revealChild, selectChild, selectedChildId, selectedChildMode, subscribeSidechainPanel,
  toggleSidechainPanel, writePanelWidth,
} from './panel-state.ts'
import { resolveChildActivity, type ChildActivity } from './child-activity.ts'
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
  /** Open an absolute path through the Session Controller. */
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
    mode: 'one-shot' | 'continuable' | 'unknown'
    command?: SideMode
    activity: 'running' | 'inactive'
    label: string
  }
  | {
    kind: 'diagnostic'
    id: SessionId
    reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/**
 * Resolve the catalog into display rows: child entries carry their durable
 * label when present, falling back to the session title and then id.
 * @param catalog - the parent's catalog snapshot (absent while never fetched).
 * @param summaries - session list rows, used as the label fallback source.
 * @returns flat display rows in catalog order.
 */
export function sidechainRows(
  catalog: SessionProjectionSnapshot | undefined,
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): SidechainRow[] {
  if (catalog === undefined) return []
  return (catalog.values.subagentCatalog ?? []).map((entry): SidechainRow => {
    if (entry.mode === 'external') return { kind: 'diagnostic', id: entry.id, reason: 'unsupported' }
    const command = catalog.values.sidechainModes?.[entry.id]
    return {
      kind: 'child',
      id: entry.id,
      mode: entry.mode,
      ...(command === undefined ? {} : { command }),
      activity: summaries[entry.id]?.running === true ? 'running' : 'inactive',
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

/**
 * Shared token-level palette. DSH web themes the shell through its design
 * tokens (`--dsw-alias-*` / `--dsw-specific-*`, declared on `body` and
 * overridden under `body[data-ds-dark-theme]` by the host's theme plugin),
 * so consuming those tokens makes the panel follow the active theme with no
 * theme JS of our own. Every token carries a light-mode literal fallback so
 * older hosts that do not inject the token stylesheet still render the
 * panel's light appearance.
 */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const C = {
  /** Primary text (light #0f1115 / dark #f9fafb). */
  text1: 'var(--dsw-alias-label-primary, #0f1115)',
  /** Secondary text (light #61666b / dark #cfd3d6). */
  text2: 'var(--dsw-alias-label-secondary, #61666b)',
  /** Tertiary text (light #81858c / dark #adb2b8). */
  text3: 'var(--dsw-alias-label-tertiary, #81858c)',
  /** Solid neutral surface for active chips (light #f1f3f5 / dark #353638). */
  surface2: 'var(--dsw-alias-interactive-bg-hover-solid, #f1f3f5)',
  /** Hover wash (light rgba(38,49,81,0.06) / dark rgba(255,255,255,0.08)). */
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 81, 0.06))',
  /** Hairline borders (light rgba(0,0,0,0.10) / dark rgba(255,255,255,0.12)). */
  border: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
  /** Primary fill for badges and send button — the in-chat primary action
   *  fill, DeepSeek blue in both themes (matching the host composer). */
  primary: 'var(--dsw-alias-button-info-fill, #4176e6)',
  /** Foreground on the primary fill; the host keeps white on info-fill. */
  onPrimary: '#fff',
  /** Error / destructive. */
  danger: 'var(--dsw-alias-state-error-primary, #ec1313)',
  /** User-bubble tint, matching the main chat's bubble surface. */
  bubble: 'var(--dsw-specific-bubble, #edf3fe)',
  /** Neutral platform surface (light #f5f6f7 / dark #353638). */
  platform: 'var(--dsw-alias-bg-module-platform, #f5f6f7)',
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
    background: C.primary, color: C.onPrimary, fontSize: 11, lineHeight: '16px', textAlign: 'center',
  },
  panel: {
    position: 'fixed', top: 'var(--dsh-sidechain-panel-top, 0px)', right: 0, bottom: 0, width: 360, maxWidth: '92vw',
    display: 'flex', flexDirection: 'column',
    background: 'var(--dsw-alias-bg-layer-1, #ffffff)', borderLeft: `1px solid ${C.border}`,
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
    borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface2,
  },
  userText: {
    padding: '6px 10px', borderRadius: 10,
    background: C.platform, color: C.text1,
    width: 'fit-content', maxWidth: '100%', fontSize: 13, lineHeight: 1.5,
  },
  assistantRow: { alignSelf: 'flex-start', maxWidth: '100%' },
  assistantText: {
    padding: '6px 10px', borderRadius: 10,
    background: C.bubble, color: C.text1,
    width: 'fit-content', maxWidth: '100%', fontSize: 13, lineHeight: 1.5,
  },
  disclosureSummary: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: C.text2,
  },
  disclosureSeparator: {
    flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1,
    background: C.text3,
  },
  disclosureBody: {
    margin: '4px 0 4px 22px', padding: '8px 10px', maxHeight: 240, overflow: 'auto',
    borderRadius: 6, background: 'var(--dsw-alias-markdown-code-block, #f9fafb)', color: C.text2,
    fontFamily: MONO, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
  },
  toolRow: { color: C.text2, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  toolFailed: { color: C.danger },
  toolDetail: { padding: '4px 0 6px' },
  toolArgs: {
    margin: '4px 0', padding: '6px 8px', borderRadius: 6,
    background: 'var(--dsw-alias-markdown-code-block, #f9fafb)', fontFamily: MONO,
    fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    maxHeight: 180, overflowY: 'auto',
  },
  composer: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderTop: `1px solid ${C.border}`,
  },
  input: {
    flex: 1, minWidth: 0, padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 8,
    background: 'var(--dsw-specific-input-major, #ffffff)', color: C.text1, fontSize: 13, outline: 'none',
  },
  sendButton: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, padding: 0, border: 'none', borderRadius: 8,
    background: C.primary, color: C.onPrimary, cursor: 'pointer',
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
  const mode = row.mode === 'unknown' ? t('mode.unknown')
    : row.mode === 'one-shot' || row.command === 'btw' ? t('mode.oneShot') : t('mode.continuable')
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
  const resultText = detail?.result === undefined ? undefined : resultViewSummary(detail.result)
  const inputText = prettyToolInput(undefined, detail?.arguments)
  const expandable = inputText !== undefined || resultText !== undefined || detail?.error !== undefined
  return (
    <DisclosureRow
      icon={<StateDot state={row.failed ? 'error' : running ? 'ongoing' : 'done'} />}
      title={row.name}
      open={open}
      expandable={expandable}
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={row.failed ? ' ✗' : undefined}
    >
      <div style={styles.toolDetail}>
        {inputText !== undefined && <pre style={styles.toolArgs}>{inputText}</pre>}
        {resultText !== undefined && (
          <div style={{ margin: '4px 0' }}>
            <MarkdownText
              text={resultText}
              streaming={false}
              labels={{ code: codeLabels ?? { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }}
            />
          </div>
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
      icon={row.kind === 'reasoning' ? <IconThinkOutlineRegular size={14} /> : <IconBrowseOutlineRegular size={14} />}
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
  const labels = { code: codeLabels ?? { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
  if (row.kind === 'user') {
    return (
      <div style={styles.userRow}>
        {row.images !== undefined && <TranscriptImages images={row.images} />}
        {row.text !== '' && <div style={styles.userText}>
          <MarkdownText text={row.text} streaming={streaming} labels={labels} fileMentions={fileMentions} />
        </div>}
      </div>
    )
  }
  if (row.kind === 'assistant') {
    return (
      <div style={styles.assistantRow}>
        {row.images !== undefined && <TranscriptImages images={row.images} />}
        {row.text !== '' && <div style={styles.assistantText}>
          <MarkdownText text={row.text} streaming={streaming} labels={labels} fileMentions={fileMentions} />
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
  if (row.kind === 'error') {
    return (
      <div style={{ ...styles.assistantRow, color: C.danger }}>
        <div style={styles.assistantText}>
          <MarkdownText text={row.text} streaming={false} labels={labels} fileMentions={fileMentions} />
        </div>
      </div>
    )
  }
  return <ToolRow row={row} running={streaming && row.detail?.result === undefined} codeLabels={codeLabels} />
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
  const catalog = useSessions(state => state.projectionsBySession[sessionId])
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
      <IconBranchOutlineRegular size={16} />
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
  sessionId, useChat, useSessions, readTranscript, readActivity, sendPrompt, refresh, openPath, t,
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
  const chatNodes = useChat(snapshot => snapshot.nodes.values())
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

  const catalogs = useSessions(state => state.projectionsBySession)
  const summaries = useSessions(state => state.byId)
  const catalog = catalogs[sessionId]
  const rows = useMemo(() => sidechainRows(catalog, summaries), [catalog, summaries])
  const running = runningCount(rows)
  // Stable reference: MarkdownText bakes codeLabels into its streaming cache
  // and discards the cache when the reference changes (see its module doc).
  const codeLabels = useMemo(() => ({ copyLabel: t('code.copy'), copiedLabel: t('code.copied') }), [t])

  // The injected actions can be recreated per render; keep effects pinned to
  // stable keys, reading the latest actions through a ref.
  const actionsRef = useRef({ readTranscript, readActivity, sendPrompt, refresh })
  actionsRef.current = { readTranscript, readActivity, sendPrompt, refresh }

  useEffect(() => {
    if (!open) return
    const { refresh } = actionsRef.current
    refresh(sessionId)
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
  // Prefer the catalog's mode; fresh local activations are always continuable.
  const address = useMemo<SubagentAddress | undefined>(() => {
    if (selected === undefined) return undefined
    const row = rows.find(candidate => candidate.kind === 'child' && candidate.id === selected)
    const mode = row?.kind === 'child' ? row.mode : selectedMode === undefined ? undefined : 'continuable'
    return mode === undefined
      ? undefined
      : { parentSessionId: sessionId, childSessionId: selected, mode }
  }, [selected, rows, selectedMode, sessionId])

  // The selected child's catalog row (its activity drives the live poll).
  const selectedRow = selected === undefined
    ? undefined
    : rows.find(candidate => candidate.id === selected)
  const selectedChild = selectedRow !== undefined && selectedRow.kind === 'child' ? selectedRow : undefined
  // Resolve the selected child's activity through the tri-state resolver so
  // missing or loading data is never reported as `running`. The session
  // summary's running bit is preferred when present (host-updated), otherwise
  // the catalog entry is used; a missing child on a ready catalog is
  // `inactive`, and a not-yet-loaded / loading / errored catalog is `unknown`.
  // `selectedMode` only carries the child's mode (one-shot / continuable) and
  // is intentionally NOT used to infer activity.
  const summaryRunning = selected === undefined ? undefined : summaries[selected]?.running
  const selectedActivity: ChildActivity = resolveChildActivity({
    catalogState: catalog?.state ?? 'absent',
    catalogActivity: selectedChild?.activity,
    summaryRunning,
  })
  const selectedRunning = selectedActivity === 'running'

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
  const pendingFinalRead = useRef<SubagentAddress | undefined>(undefined)
  const request = useCallback((target: SubagentAddress, showLoading: boolean, final = false) => {
    if (fetchInFlight.current && final) {
      pendingFinalRead.current = target
      return
    }
    if (fetchInFlight.current && !showLoading) return
    const epoch = ++fetchEpoch.current
    if (showLoading) {
      pendingFinalRead.current = undefined
      setTranscriptState('loading')
    }
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
      const pending = pendingFinalRead.current
      pendingFinalRead.current = undefined
      if (pending !== undefined) request(pending, false)
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

  // On a running/unknown → inactive transition (the catalog activity flip): pull
  // the settled transcript exactly, and mark the finalize swap — the rows
  // switch from streaming to settled rendering (syntax highlighting, KaTeX,
  // file mentions land) — with a brief fade via the Web Animations API.
  // The guard records the child identity: switching to another child must
  // reset it, so a long-finished child never replays the previous child's
  // settle transition. `unknown -> inactive` matters when a fast child ends
  // before the catalog's first successful read; without the final fetch the
  // panel can retain the partial transcript from its initial read.
  const settleGuard = useRef<{ id: SessionId | undefined; activity: ChildActivity } | undefined>(undefined)
  useEffect(() => {
    // Keep tracking the selected id even when a ready catalog no longer
    // contains the child. The address can still be reconstructed from the
    // selection/mode, and this is the exact transition where the final
    // transcript fetch is needed.
    if (selected === undefined) {
      settleGuard.current = undefined
      return
    }
    const previous = settleGuard.current
    settleGuard.current = { id: selected, activity: selectedActivity }
    if (previous === undefined || previous.id !== selected) return
    if (
      selectedActivity === 'inactive'
      && (previous.activity === 'running' || previous.activity === 'unknown')
    ) {
      const target = addressRef.current
      if (target !== undefined) request(target, false, true)
      const el = transcriptRef.current
      if (el !== null && !prefersReducedMotion()) {
        el.animate(
          [{ opacity: 0.7 }, { opacity: 1 }],
          { duration: 260, easing: 'ease-out' },
        )
      }
    }
  }, [selected, selectedActivity, request])

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
      {mounted && typeof document !== 'undefined' && createPortal(
        <aside
          ref={panelRef}
          className="dsh-sidechain-panel"
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
                aria-label={t('view.back')}
                onClick={() => {
                  // Leave the thread first: returning to the list must never
                  // depend on the catalog refresh (a rejected projection pull
                  // would otherwise abort the handler).
                  selectChild(undefined)
                  try {
                    actionsRef.current.refresh(sessionId)
                  } catch {
                    // The list renders from the store; a failed refresh only
                    // leaves it as stale as it already was.
                  }
                }}
              >
                <IconChevronLeftOutlineRegular size={14} />
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
              <IconFullscreenOutlineRegular size={16} />
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
              <IconRefreshOutlineRegular size={14} />
            </button>
            <button
              type="button"
              style={styles.iconButton}
              title={t('panel.close')}
              aria-label={t('panel.close')}
              onClick={closeSidechainPanel}
            >
              <IconCloseOutlineRegular size={16} />
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
                    color: 'var(--dsw-alias-state-business-primary, #4176e6)',
                    textAlign: 'left',
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}>{t('view.waiting')}</div>
                )}
              </div>
              {address.mode !== 'continuable' || selectedChild?.command === 'btw' || selectedMode === 'one-shot' ? (
                <div style={styles.readonly}>{t(address.mode === 'unknown' ? 'mode.unknown' : 'view.readonly')}</div>
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
                    <IconRightUpOutlineRegular size={14} />
                  </button>
                </form>
              )}
              {sendFailed && <div style={styles.error}>{t('view.sendFailed')}</div>}
            </div>
          )}
        </aside>,
        document.body,
      )}
    </>
  )
}
