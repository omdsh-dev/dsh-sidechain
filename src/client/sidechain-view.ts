/**
 * Embedded side-conversation transcript model (browser half).
 *
 * The panel renders a child's conversation from `subagent.history` — the
 * catalog's message-aligned transcript RPC, which reads the durable log
 * WITHOUT activating the child or changing the current session.
 *
 * A sidechain child's log starts with the ENTIRE inherited parent history as
 * its fork seed (reference context). The mapping therefore cuts everything
 * up to the LAST `session/end-seed` event (the constructor seed marker) and
 * drops the fork's "Side conversation boundary" prompt row, so the panel
 * shows only the child's own side conversation.
 *
 * Live streaming: `assistant/message` events only land when a step completes,
 * but `assistant/chunk` events stream token-level text and reasoning deltas.
 * The mapping accumulates both per block and supersedes them with the
 * assembled message once it lands. Tail polls merge into a per-child event
 * cache, so old rounds remain visible without re-reading the inherited seed.
 */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy'
import type { ToolCallView, ToolEventView, ToolResultView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-client-connection/client'
import { contextProvenance } from '@deepseek-ai/dsh-client-runtime/client'
import { lastActivity } from './sidechain-activity.ts'

/**
 * Tail-page size for one transcript fetch (messages per page). Small on
 * purpose: a side child inherits the ENTIRE parent history as its fork seed,
 * and the seed is dense with chunk/reasoning events — a large window would
 * drag megabytes of inherited seed across the wire for every poll.
 */
export const TRANSCRIPT_PAGE_MESSAGES = 8
/** Activity fetch: even smaller pages, fewer pages (only needs the tail). */
export const ACTIVITY_PAGE_MESSAGES = 6
export const ACTIVITY_PAGE_CAP = 4

/** One compact transcript row rendered in the panel. `seq` is the source
 *  event's log sequence — stable row identity for React keys across polls
 *  (streaming caches ride the key, so window slides must not re-key rows). */
/** Detail attached to one tool row: host-computed render views (call +
 *  result) and the raw arguments, paired by the result's toolCallId. */
export interface ToolDetail {
  callView?: ToolCallView | undefined
  resultView?: ToolResultView | undefined
  arguments?: string | undefined
  error?: { name: string; code: string } | undefined
}

type ImageAttachmentRef = Extract<ContentBlock, { type: 'image' }>['attachment']

/** An image reference plus its browser-ready data URL when the host can serve it. */
export interface TranscriptImage {
  attachment: ImageAttachmentRef
  url?: string | undefined
}

export type TranscriptRow =
  | { kind: 'user'; seq: number; text: string; images?: readonly TranscriptImage[] }
  | { kind: 'assistant'; seq: number; text: string; images?: readonly TranscriptImage[] }
  | { kind: 'reasoning'; seq: number; text: string }
  | {
    kind: 'context'
    seq: number
    text: string
    source: string | null
    recall: boolean
    images?: readonly TranscriptImage[]
  }
  | { kind: 'tool'; seq: number; name: string; failed: boolean; detail?: ToolDetail | undefined }

/** The fork boundary prompt's first line (marker for the side boundary message). */
const BOUNDARY_PREFIX = 'Side conversation boundary'

/**
 * Strip the internal side-conversation boundary envelope off an opening user
 * message, returning just the user's own question. The boundary message is
 * built by {@link sidePrompt} as: boundary prompt + mode line + question.
 * When the message is not a boundary (no `Mode:` line present) it is treated
 * as a pure internal envelope and dropped (`null`).
 */
function stripSideBoundary(text: string): string | null {
  if (!text.startsWith(BOUNDARY_PREFIX)) return text
  const modeIndex = text.indexOf('\nMode:')
  if (modeIndex < 0) return null
  const afterMode = text.indexOf('\n', modeIndex + 1)
  if (afterMode < 0) return null
  const rest = text.slice(afterMode + 1).trim()
  return rest === '' ? null : rest
}

/**
 * Extract the visible text of a content block list: `text` blocks verbatim,
 * joined by blank lines; everything else (reasoning, tool blocks) contributes
 * nothing. An empty result reads `…` so rows never render blank.
 * @param blocks - model-facing content blocks.
 * @returns the joined visible text.
 */
export function blockText(blocks: readonly ContentBlock[]): string {
  const text = blocks
    .map(block => (block.type === 'text' ? block.text : ''))
    .filter(part => part !== '')
    .join('\n\n')
  return text === '' ? '…' : text
}

function imageRefs(blocks: readonly ContentBlock[]): ImageAttachmentRef[] {
  return blocks.flatMap(block => block.type === 'image' ? [block.attachment] : [])
}

function transcriptImages(refs: readonly ImageAttachmentRef[]): TranscriptImage[] {
  return refs.map(attachment => ({ attachment }))
}

function rowText(blocks: readonly ContentBlock[], images: readonly ImageAttachmentRef[]): string {
  const text = blockText(blocks)
  return images.length > 0 && text === '…' ? '' : text
}

/** Index of the last `session/end-seed` event (fork seed marker), or -1. */
function lastSeedEnd(events: readonly SessionEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'session/end-seed') return i
  }
  return -1
}

/**
 * Map a session log's history rows onto compact transcript rows: the
 * inherited fork seed is cut at the last `session/end-seed`, the boundary
 * prompt is dropped, `assistant/chunk` text deltas accumulate into a
 * streaming row per step (superseded by the assembled `assistant/message`),
 * and tool invocations render one expandable line each — the call's view,
 * raw arguments, and the paired result's view (matched by the result's
 * `toolCallId`) ride the row as detail; a failing `tool/result` marks it.
 * @param entries - history rows (event + host-computed view) in seq order.
 * @returns display rows in log order.
 */
export function transcriptRows(entries: readonly TranscriptEntry[]): TranscriptRow[] {
  const events = entries.map(entry => entry.event)
  const seedEnd = lastSeedEnd(events)
  const rows: TranscriptRow[] = []
  /** (turn, step, block, kind) key → index of its accumulating stream row. */
  const streamRows = new Map<string, number>()
  /** tool callId → index of its tool row in `rows` (result pairing). */
  const callRows = new Map<string, number>()
  for (let i = 0; i < events.length; i++) {
    if (i <= seedEnd) continue
    const event = events[i] as SessionEvent
    const view = entries[i]?.view
    switch (event.type) {
      case 'user/message': {
        const refs = imageRefs(event.data.content)
        const text = rowText(event.data.content, refs)
        const images = refs.length === 0 ? {} : { images: transcriptImages(refs) }
        const stripped = stripSideBoundary(text)
        if (stripped === null) break
        const displayText = stripped === text ? text : stripped
        const source = event.data.source as unknown
        const sourceKind = typeof source === 'object' && source !== null
          ? (source as Record<string, unknown>)['kind']
          : undefined
        if (sourceKind === undefined || sourceKind === 'user') {
          rows.push({ kind: 'user', seq: event.seq, text: displayText, ...images })
        } else {
          const provenance = contextProvenance(source)
          rows.push({
            kind: 'context', seq: event.seq, text: displayText,
            source: provenance.label,
            recall: provenance.role === 'recall',
            ...images,
          })
        }
        break
      }
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if ((chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') || chunk.text === '') break
        const kind = chunk.type === 'text-delta' ? 'assistant' : 'reasoning'
        const key = `${event.data.turn}:${event.data.step}:${chunk.index}:${kind}`
        const existing = streamRows.get(key)
        if (existing !== undefined) {
          const row = rows[existing]
          if (row !== undefined && row.kind === kind) {
            rows[existing] = { ...row, text: row.text + chunk.text }
          }
        } else {
          streamRows.set(key, rows.length)
          rows.push({ kind, seq: event.seq, text: chunk.text })
        }
        break
      }
      case 'assistant/message': {
        const prefix = `${event.data.turn}:${event.data.step}:`
        const streamed = [...streamRows.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, index]) => index)
        for (const key of [...streamRows.keys()]) {
          if (key.startsWith(prefix)) streamRows.delete(key)
        }
        const settled = event.data.message.content.flatMap((block): TranscriptRow[] => {
          if (block.type === 'reasoning' && block.text !== '') {
            return [{ kind: 'reasoning', seq: event.seq, text: block.text }]
          }
          if (block.type === 'text' && block.text !== '') {
            return [{ kind: 'assistant', seq: event.seq, text: block.text }]
          }
          return []
        })
        const refs = imageRefs(event.data.message.content)
        if (refs.length > 0) {
          const images = transcriptImages(refs)
          const assistant = settled.findIndex(row => row.kind === 'assistant')
          if (assistant >= 0) {
            const row = settled[assistant]
            if (row !== undefined && row.kind === 'assistant') settled[assistant] = { ...row, images }
          } else {
            settled.push({ kind: 'assistant', seq: event.seq, text: '', images })
          }
        }
        if (settled.length === 0 && event.data.message.content.length === 0) {
          settled.push({ kind: 'assistant', seq: event.seq, text: '…' })
        }
        if (streamed.length === 0) rows.push(...settled)
        else rows.splice(Math.min(...streamed), streamed.length, ...settled)
        break
      }
      case 'tool/call': {
        const data = event.data
        callRows.set(data.callId, rows.length)
        rows.push({
          kind: 'tool',
          seq: event.seq,
          name: data.name,
          failed: false,
          detail: {
            arguments: data.arguments,
            ...(view !== undefined && view.for === 'call' ? { callView: view.view } : {}),
          },
        })
        break
      }
      case 'tool/result': {
        const data = event.data
        const resultBlock = data.message.content[0]
        const callId = resultBlock?.toolCallId
        const index = callId === undefined ? undefined : callRows.get(callId)
        const error = data.error
        // A result is failed on the explicit event error OR the block's own
        // isError flag (tools report hard failures either way).
        const failed = error !== undefined || resultBlock?.isError === true
        if (index !== undefined) {
          const row = rows[index]
          if (row !== undefined && row.kind === 'tool') {
            rows[index] = {
              ...row,
              failed,
              detail: {
                ...row.detail,
                ...(view !== undefined && view.for === 'result' ? { resultView: view.view } : {}),
                ...(error === undefined ? {} : { error }),
              },
            }
          }
        } else if (failed) {
          // Orphan result (no call row in the window): surface the failure
          // with its error so the row stays informative and expandable.
          rows.push({
            kind: 'tool', seq: event.seq, name: 'tool', failed: true,
            ...(error === undefined ? {} : { detail: { error } }),
          })
        }
        break
      }
      default: {
        break
      }
    }
  }
  return rows
}

/** One history row as subagent.history returns it (event + host-computed view). */
export interface TranscriptEntry {
  event: SessionEvent
  view?: ToolEventView | undefined
}

/**
 * Files the child's tool calls report having created or changed, by render
 * intent rather than tool name — the same policy as the main chat's
 * ui-deliverables: a diff card, or a generic card whose `kind` is `edit`
 * (the shape `str_replace_editor`'s insert presents). Reads, deletes, and
 * plain terminal runs produce nothing. Paths keep first-seen order and
 * appear once.
 * @param entries - history rows (views are re-derived per read by the host).
 * @returns produced file paths.
 */
export function producedPaths(entries: readonly TranscriptEntry[]): string[] {
  // The same seed cut transcriptRows applies: a fresh child's tail window
  // contains the inherited parent history, whose write/edit calls would
  // otherwise leak the PARENT's produced files into this child's vocabulary.
  const seedEnd = lastSeedEnd(entries.map(entry => entry.event))
  // Calls whose result failed produced nothing to open (ui-deliverables
  // policy: failed calls do not count).
  const failedCallIds = new Set<string>()
  for (let i = seedEnd + 1; i < entries.length; i++) {
    const event = entries[i]?.event
    if (event === undefined || event.type !== 'tool/result') continue
    const block = event.data.message.content[0]
    const callId = block?.toolCallId
    if (callId === undefined) continue
    if (event.data.error !== undefined || block?.isError === true) failedCallIds.add(callId)
  }
  const paths: string[] = []
  const seen = new Set<string>()
  for (let i = seedEnd + 1; i < entries.length; i++) {
    const entry = entries[i] as TranscriptEntry
    const view = entry.view
    if (view === undefined || view.for !== 'call') continue
    const call = view.view
    if (entry.event.type !== 'tool/call' || failedCallIds.has(entry.event.data.callId)) continue
    const locations = call.card === 'diff'
      ? call.locations
      : call.card === 'generic' && call.kind === 'edit'
        ? call.locations
        : undefined
    if (locations === undefined) continue
    for (const location of locations) {
      if (seen.has(location.path)) continue
      seen.add(location.path)
      paths.push(location.path)
    }
  }
  return paths
}

/** One-line summary of a non-terminal result view, for the expanded tool row. */
export function resultViewSummary(view: ToolResultView): string | undefined {
  switch (view.card) {
    case 'generic': {
      return view.content === undefined ? undefined : blockText(view.content)
    }
    case 'diff': {
      const paths = view.diffs.map(diff => diff.path)
      const lines = view.diffs.reduce(
        (total, diff) => total + diff.newText.split('\n').length + (diff.oldText === null ? 0 : diff.oldText.split('\n').length),
        0,
      )
      return `${paths.join(', ')} · ${lines} 行变更`
    }
    case 'read': {
      if (view.content !== undefined) return blockText(view.content)
      return `${view.path} · 显示 ${view.lines.length}/${view.totalLines} 行`
    }
    case 'search': {
      if (view.shape === 'paths') return `${view.paths.length} 个路径`
      const files = view.files.length
      const matches = view.files.reduce((total, file) => total + file.matches.length, 0)
      return `${files} 个文件 · ${matches} 处匹配`
    }
    case 'web': {
      if (view.kind === 'search') return `${view.sources.length} 个来源`
      return `${view.url} · HTTP ${view.statusCode}`
    }
    case 'terminal': {
      return undefined
    }
  }
}

/**
 * Union two produced-file vocabularies, keeping first-seen order. The panel
 * accumulates across polls: a produced path whose call row slides out of the
 * 20-message tail window must keep its mentions working.
 * @param previous - the accumulated vocabulary (may be empty on first fetch).
 * @param next - the current window's vocabulary.
 * @returns the union in first-seen order.
 */
export function mergeProduced(
  previous: readonly string[],
  next: readonly string[],
): string[] {
  const seen = new Set(previous)
  return [...previous, ...next.filter(path => !seen.has(path))]
}

/**
 * Fetch a child's transcript.
 *
 * Reads through `session.history` rather than `subagent.history`: the
 * subagent path serves history without a presenter scope, so tool events
 * carry no render views (and no produced-file locations); the session path
 * resolves the session's preset scope from its log (`presenterScopeFor`),
 * so views — and thus the produced-file vocabulary — are available even for
 * cold (finished) children.
 *
 * The child's log STARTS with the entire inherited parent history (fork
 * seed), which can be tens of thousands of chunk events. A single large
 * tail window would ship megabytes of seed per poll (measured: 20 messages
 * → ~7000 events, 1.4 MB, ~8 s on a long parent session). Instead the read
 * pages backwards in small windows until a window contains the seed
 * boundary, then cuts there. Later reads fetch one tail page and merge those
 * events into the cached child transcript, retaining earlier rounds.
 * @param sessions - the api client's sessions surface.
 * @param address - durable parent/child address (only the child id is used).
 * @returns display rows plus the produced-file vocabulary, or null on
 *   transport/business failure.
 */
export async function fetchTranscript(
  sessions: IApiClient['sessions'],
  address: SubagentAddress,
): Promise<{ rows: readonly TranscriptRow[]; produced: readonly string[] } | null> {
  const entries = await fetchSeedCutEntries(
    sessions, address.childSessionId, TRANSCRIPT_PAGE_MESSAGES,
  )
  if (entries === null) return null
  const previous = transcriptEntryCache.get(address.childSessionId) ?? []
  const bySeq = new Map(previous.map(entry => [entry.event.seq, entry]))
  for (const entry of entries) bySeq.set(entry.event.seq, entry)
  const transcript = [...bySeq.values()].sort((a, b) => a.event.seq - b.event.seq)
  transcriptEntryCache.set(address.childSessionId, transcript)
  const rows = await hydrateTranscriptImages(sessions, address.childSessionId, transcriptRows(transcript))
  return {
    rows,
    produced: producedPaths(transcript),
  }
}

/**
 * Fetch one running child's live activity line (latest assistant text or
 * last tool call) from a light seed-cut tail page — the list-row preview
 * poll, kept much cheaper than the full transcript page (no produced
 * vocabulary, fewer pages).
 * @param sessions - the api client's sessions surface.
 * @param address - durable parent/child address (only the child id is used).
 * @returns the activity line, or null on transport/business failure or an
 *   empty tail.
 */
export async function fetchActivity(
  sessions: IApiClient['sessions'],
  address: SubagentAddress,
): Promise<string | null> {
  const entries = await fetchSeedCutEntries(
    sessions, address.childSessionId, ACTIVITY_PAGE_MESSAGES, ACTIVITY_PAGE_CAP,
  )
  if (entries === null) return null
  return lastActivity(transcriptRows(entries)) ?? null
}

/**
 * Per-child seed-boundary cache: the seq of the child's last
 * `session/end-seed` marker. Once the first walk locates it, every later read
 * needs at most ONE page — either the page contains the end-seed and the
 * normal cut applies, or the page is entirely the child's own content and the
 * cached boundary supplies the cut (a seq filter no-op). The dense inherited
 * seed is never re-downloaded after the first walk.
 */
const seedBoundaryCache = new Map<string, number>()
/** Child-owned history accumulated from cheap tail polls. */
const transcriptEntryCache = new Map<string, readonly TranscriptEntry[]>()
const imageUrlCache = new Map<string, string | null>()

/** Test seam: drop cached seed boundaries and accumulated transcripts. */
export function resetSeedBoundaryCache(): void {
  seedBoundaryCache.clear()
  transcriptEntryCache.clear()
  imageUrlCache.clear()
}

async function hydrateTranscriptImages(
  sessions: IApiClient['sessions'],
  childSessionId: SubagentAddress['childSessionId'],
  rows: readonly TranscriptRow[],
): Promise<TranscriptRow[]> {
  const refs = new Map<string, ImageAttachmentRef>()
  for (const row of rows) {
    for (const image of 'images' in row ? row.images ?? [] : []) {
      refs.set(String(image.attachment.attachmentId), image.attachment)
    }
  }
  if (refs.size === 0) return [...rows]

  const attachment = sessions.attachment
  if (typeof attachment !== 'function') return [...rows]
  await Promise.all([...refs].map(async ([id, ref]) => {
    if (imageUrlCache.has(id)) return
    try {
      const response = await attachment.call(sessions, {
        sessionId: childSessionId,
        attachmentId: ref.attachmentId,
      })
      if (!response.result.ok) {
        imageUrlCache.set(id, null)
        return
      }
      const data = response.result.value.data
      imageUrlCache.set(id, data.startsWith('data:') ? data : `data:${ref.mediaType};base64,${data}`)
    } catch {
      imageUrlCache.set(id, null)
    }
  }))

  return rows.map(row => {
    if (!('images' in row) || row.images === undefined) return row
    return {
      ...row,
      images: row.images.map(image => {
        const url = imageUrlCache.get(String(image.attachment.attachmentId))
        return { ...image, ...(typeof url === 'string' ? { url } : {}) }
      }),
    }
  })
}

/**
 * Page a child's log backwards from the tail in small windows until a window
 * contains the fork seed's closing marker (`session/end-seed`), then return
 * everything after that marker — the child's own conversation only.
 *
 * The host pages strictly backward (`beforeSeq` is an exclusive upper bound),
 * so there is no "start after the boundary" fetch: the first read of a child
 * walks back until a window contains the newest end-seed (usually the first
 * window; a long child's own conversation may need one more). The boundary
 * seq is then cached — later reads (the live polls) fetch one tail window and
 * cut with the cache. Overlap between pages is deduped by sequence, so an
 * inclusive `beforeSeq` contract on the host is harmless.
 * @param sessions - the api client's sessions surface.
 * @param childSessionId - the child whose own conversation to read.
 * @param pageMessages - messages per backward page.
 * @param pageCap - optional backward-page cap for lightweight callers. The
 *   transcript read omits it and continues until the seed boundary.
 * @returns the seed-cut entries, or null on transport/business failure.
 */
async function fetchSeedCutEntries(
  sessions: IApiClient['sessions'],
  childSessionId: string,
  pageMessages: number,
  pageCap?: number,
): Promise<readonly TranscriptEntry[] | null> {
  const cachedBoundary = seedBoundaryCache.get(childSessionId)
  const collected: TranscriptEntry[] = []
  let beforeSeq: number | undefined
  let boundarySeq = cachedBoundary
  try {
    for (let page = 0; page < (pageCap ?? Number.POSITIVE_INFINITY); page++) {
      const response = await sessions.history({
        sessionId: childSessionId as SubagentAddress['childSessionId'],
        maxMessages: pageMessages,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      })
      if (!response.result.ok) return null
      const events = response.result.value.events
      if (events.length === 0) break
      const olderThan = collected.length > 0 ? collected[0]!.event.seq : undefined
      const fresh = olderThan === undefined
        ? events
        : events.filter(entry => entry.event.seq < olderThan)
      const seedEnd = lastSeedEnd(fresh.map(entry => entry.event))
      if (seedEnd >= 0) {
        // The newest end-seed in this window is the operative boundary.
        boundarySeq = fresh[seedEnd]!.event.seq
        seedBoundaryCache.set(childSessionId, boundarySeq)
        collected.unshift(...fresh.slice(seedEnd + 1))
        break
      }
      if (boundarySeq !== undefined) {
        // Cached boundary + a window without the marker: the window is
        // entirely the child's own content — the seq filter is a safe no-op.
        const boundary = boundarySeq
        collected.unshift(...fresh.filter(entry => entry.event.seq > boundary))
        break
      }
      collected.unshift(...fresh)
      if (fresh.length === 0) break
      beforeSeq = fresh[0]!.event.seq
    }
  } catch {
    return null
  }
  return collected
}

/**
 * Deliver one human message to a continuable child through its exact
 * direct-parent address (the same non-activating transport the runtime's
 * catalog navigation uses).
 * @param subagents - the api client's subagents surface.
 * @param address - continuable parent/child address.
 * @param text - the message body (one text block).
 * @returns whether the prompt was accepted.
 */
export async function sendPrompt(
  subagents: IApiClient['subagents'],
  address: Extract<SubagentAddress, { mode: 'continuable' }>,
  text: string,
): Promise<boolean> {
  try {
    const response = await subagents.prompt({
      ...address,
      content: [{ type: 'text', text }] satisfies readonly ContentBlock[],
    })
    return response.result.ok
  } catch {
    return false
  }
}
