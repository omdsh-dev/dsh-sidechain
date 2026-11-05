/**
 * Embedded side-conversation transcript model (browser half).
 *
 * The panel renders a child's conversation from alpha Session Remote history,
 * which reads the durable log without activating the child or changing the current session.
 *
 * A sidechain child's log starts with the ENTIRE inherited parent history as
 * its fork seed (reference context). The mapping therefore cuts everything
 * before the first "Side conversation boundary" prompt and its preceding
 * seed marker, so continuation-turn seed markers do not hide older turns.
 *
 * Live streaming: `assistant/message` events only land when a step completes,
 * but the follow snapshot carries the active assistant stream's text and reasoning deltas.
 * The mapping accumulates both per block and supersedes them with the
 * assembled message once it lands. Tail polls merge into a per-child event
 * cache, so old rounds remain visible without re-reading the inherited seed.
 */

import type { SessionRemote, SessionEventLike as SessionEvent } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionAddress, SessionFollowFrame, SessionHistoryRecord } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { expandAssistantStream, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { SubagentAddress, SubagentPromptRequest, SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent/client'
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

/** Detail attached to one tool row from alpha's raw Session events. */
export interface ToolDetail {
  arguments?: string | undefined
  result?: readonly ContentBlock[] | undefined
  meta?: unknown
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
  | { kind: 'error'; seq: number; text: string }
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

function isSideBoundaryEvent(event: SessionEvent): boolean {
  return event.type === 'user/message'
    && event.data.content.some(block => block.type === 'text' && block.text.startsWith(BOUNDARY_PREFIX))
}

/** Seed marker immediately before the child's first boundary prompt, or the
 * latest marker for legacy logs without a boundary. */
function transcriptSeedEnd(events: readonly SessionEvent[]): number {
  const boundary = events.findIndex(isSideBoundaryEvent)
  if (boundary >= 0) {
    for (let i = boundary - 1; i >= 0; i--) {
      if (events[i]?.type === 'session/end-seed') return i
    }
    return -1
  }
  return lastSeedEnd(events)
}

/**
 * Map a session log's history rows onto compact transcript rows: the
 * inherited fork seed is cut at the first boundary's preceding
 * `session/end-seed`, the boundary prompt is dropped, `assistant/chunk` text deltas accumulate into a
 * streaming row per step (superseded by the assembled `assistant/message`),
 * and tool invocations render one expandable line each — raw arguments and
 * paired result content ride the row as detail; a failing `tool/result` marks it.
 * @param entries - expanded alpha history events in seq order.
 * @returns display rows in log order.
 */
export function transcriptRows(entries: readonly TranscriptEntry[]): TranscriptRow[] {
  const events = entries.map(entry => entry.event)
  const seedEnd = transcriptSeedEnd(events)
  const rows: TranscriptRow[] = []
  /** (turn, step, block, kind) key → index of its accumulating stream row. */
  const streamRows = new Map<string, number>()
  /** tool callId → index of its tool row in `rows` (result pairing). */
  const callRows = new Map<string, number>()
  for (let i = 0; i < events.length; i++) {
    if (i <= seedEnd) continue
    const event = events[i] as SessionEvent
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
          rows.push({
            kind: 'context', seq: event.seq, text: displayText,
            source: typeof sourceKind === 'string' ? sourceKind : null,
            recall: sourceKind === 'recall' || sourceKind === 'context-recall',
            ...images,
          })
        }
        break
      }
      case 'assistant/live-chunk': {
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
          },
        })
        break
      }
      case 'tool/result': {
        const data = event.data
        const callId = data.message.toolCallId
        const index = callId === undefined ? undefined : callRows.get(callId)
        const error = data.error
        // A result is failed on the explicit event error OR the block's own
        // isError flag (tools report hard failures either way).
        const failed = error !== undefined || data.message.isError === true
        if (index !== undefined) {
          const row = rows[index]
          if (row !== undefined && row.kind === 'tool') {
            rows[index] = {
              ...row,
              failed,
              detail: {
                ...row.detail,
                ...(data.message.content.length === 0 ? {} : { result: data.message.content }),
                ...(data.meta === undefined ? {} : { meta: data.meta }),
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
      case 'turn/end': {
        if (event.data.reason.kind !== 'error') break
        rows.push({ kind: 'error', seq: event.seq, text: event.data.reason.error.message })
        break
      }
      default: {
        break
      }
    }
  }
  return rows
}

/** One expanded alpha history event. */
export interface TranscriptEntry {
  event: SessionEvent
}

/**
 * Files the child's tool calls report having created or changed, by render
 * intent rather than tool name — the same policy as the main chat's
 * ui-deliverables: a diff card, or a generic card whose `kind` is `edit`
 * (the shape `str_replace_editor`'s insert presents). Reads, deletes, and
 * plain terminal runs produce nothing. Paths keep first-seen order and
 * appear once.
 * @param entries - expanded alpha history events.
 * @returns produced file paths.
 */
export function producedPaths(entries: readonly TranscriptEntry[]): string[] {
  // The same seed cut transcriptRows applies: a fresh child's tail window
  // contains the inherited parent history, whose write/edit calls would
  // otherwise leak the PARENT's produced files into this child's vocabulary.
  const seedEnd = transcriptSeedEnd(entries.map(entry => entry.event))
  // Calls whose result failed produced nothing to open (ui-deliverables
  // policy: failed calls do not count).
  const failedCallIds = new Set<string>()
  for (let i = seedEnd + 1; i < entries.length; i++) {
    const event = entries[i]?.event
    if (event === undefined || event.type !== 'tool/result') continue
    const message = event.data.message
    const callId = message.toolCallId
    if (callId === undefined) continue
    if (event.data.error !== undefined || message.isError === true) failedCallIds.add(callId)
  }
  const paths: string[] = []
  const seen = new Set<string>()
  for (let i = seedEnd + 1; i < entries.length; i++) {
    const entry = entries[i] as TranscriptEntry
    if (entry.event.type !== 'tool/call' || failedCallIds.has(entry.event.data.callId)) continue
    // Alpha keeps tool presentation in the client UI; recover common write
    // and edit path fields so file mentions still work in this custom view.
    if (!/(write|edit|replace|patch|create)/i.test(entry.event.data.name)) continue
    try {
      const args = JSON.parse(entry.event.data.arguments) as Record<string, unknown>
      for (const key of ['file_path', 'filePath', 'path']) {
        const path = args[key]
        if (typeof path === 'string' && !seen.has(path)) {
          seen.add(path)
          paths.push(path)
        }
      }
    } catch {
      // Invalid tool arguments cannot name a file.
    }
  }
  return paths
}

/** One-line summary of alpha tool-result content. */
export function resultViewSummary(content: readonly ContentBlock[]): string | undefined {
  return content.length === 0 ? undefined : blockText(content)
}

/**
 * Union two produced-file vocabularies, keeping first-seen order. The panel
 * accumulates across polls so a produced path remains usable after its call
 * row slides out of the current tail window.
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
 * Reads through alpha's `session.follow`/`session.page` Remote methods without
 * activating the child or changing the current session.
 *
 * The child's log starts with the entire inherited parent history (fork
 * seed), which can be tens of thousands of chunk events. A single large tail
 * window would ship the inherited seed on every poll, so the reader pages
 * backwards in small windows until a window contains the seed boundary,
 * then cuts there. Later reads fetch one tail page and merge those events into
 * the cached child transcript, retaining earlier rounds.
 * @param sessions - alpha's generated Session Remote surface.
 * @param address - durable parent/child address (only the child id is used).
 * @returns display rows plus the produced-file vocabulary, or null on
 *   transport/business failure.
 */
export async function fetchTranscript(
  sessions: SessionRemote,
  address: SubagentAddress,
): Promise<{ rows: readonly TranscriptRow[]; produced: readonly string[] } | null> {
  const entries = await fetchSeedCutEntries(
    sessions, address, TRANSCRIPT_PAGE_MESSAGES,
  )
  if (entries === null) return null
  const previous = transcriptEntryCache.get(address.childSessionId) ?? []
  const bySeq = new Map(previous.map(entry => [entry.event.seq, entry]))
  for (const entry of entries) {
    if (entry.event.type !== 'assistant/live-chunk') bySeq.set(entry.event.seq, entry)
  }
  const transcript = [...bySeq.values()].sort((a, b) => a.event.seq - b.event.seq)
  transcriptEntryCache.set(address.childSessionId, transcript)
  const live = entries.filter(entry => entry.event.type === 'assistant/live-chunk')
  const rows = await hydrateTranscriptImages(sessions, address.childSessionId, transcriptRows([...transcript, ...live]))
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
  sessions: SessionRemote,
  address: SubagentAddress,
): Promise<string | null> {
  const entries = await fetchSeedCutEntries(
    sessions, address, ACTIVITY_PAGE_MESSAGES, ACTIVITY_PAGE_CAP,
  )
  if (entries === null) return null
  return lastActivity(transcriptRows(entries)) ?? null
}

/**
 * Per-child seed-boundary cache: the seq of the marker before the child's
 * first boundary. Once the first walk locates it, every later read needs at
 * most ONE page and the dense inherited seed is never re-downloaded.
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
  sessions: SessionRemote,
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

  await Promise.all([...refs].map(async ([id, ref]) => {
    if (imageUrlCache.has(id)) return
    try {
      const request = {
        sessionId: childSessionId,
        attachment: ref,
        attachmentId: ref.attachmentId,
      }
      const response = await sessions.attachment(request)
      if (!response.ok) {
        imageUrlCache.set(id, null)
        return
      }
      const data = response.value.data
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
 * contains the first boundary prompt, then return everything after the seed
 * marker before that prompt — the child's own conversation only.
 *
 * The host pages strictly backward (`beforeSeq` is an exclusive upper bound),
 * so there is no "start after the boundary" fetch: the first read walks back
 * until a window contains the boundary. Later reads fetch one tail window and
 * cut with the cached seed marker. Overlap between pages is deduped by
 * sequence, so an inclusive `beforeSeq` contract on the host is harmless.
 * @param sessions - the api client's sessions surface.
 * @param childSessionId - the child whose own conversation to read.
 * @param pageMessages - messages per backward page.
 * @param pageCap - optional backward-page cap for lightweight callers. The
 *   transcript read omits it and continues until the seed boundary.
 * @returns the seed-cut entries, or null on transport/business failure.
 */
async function fetchSeedCutEntries(
  sessions: SessionRemote,
  childAddress: SubagentAddress,
  pageMessages: number,
  pageCap?: number,
): Promise<readonly TranscriptEntry[] | null> {
  const childSessionId = childAddress.childSessionId
  const cachedBoundary = seedBoundaryCache.get(childSessionId)
  const collected: TranscriptEntry[] = []
  let beforeSeq: number | undefined
  let boundarySeq = cachedBoundary
  const address: SessionAddress = {
    kind: 'subagent',
    parentSessionId: childAddress.parentSessionId,
    childSessionId,
    mode: childAddress.mode,
  }
  let throughSeq: number | undefined
  const live: TranscriptEntry[] = []
  try {
    for (let page = 0; page < (pageCap ?? Number.POSITIVE_INFINITY); page++) {
      let records: readonly SessionHistoryRecord[]
      let hasMore: boolean
      if (throughSeq === undefined) {
        const iterator = sessions.follow({ address, maxMessages: pageMessages, assistantStream: true })[Symbol.asyncIterator]()
        const first = await iterator.next()
        await iterator.return?.()
        if (first.done || first.value.type !== 'snapshot') return null
        const snapshot = first.value as Extract<SessionFollowFrame, { type: 'snapshot' }>
        throughSeq = snapshot.cursor
        records = snapshot.records
        hasMore = snapshot.hasMore
        const active = snapshot.assistantStream?.activeAttempt
        if (active !== undefined) {
          for (const { time, chunk } of expandAssistantStream(active.stream as AssistantStreamRecord[])) {
            live.push({ event: {
              type: 'assistant/live-chunk', seq: snapshot.cursor + 1, time,
              data: { attemptId: active.attemptId, turn: active.turn, step: active.step, chunk },
            } })
          }
        }
      } else {
        const response = await sessions.page({
          address,
          throughSeq,
          maxMessages: pageMessages,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
        })
        if (!response.ok) return null
        records = response.value.records
        hasMore = response.value.hasMore
      }
      const events = expandHistoryRecords(records)
      if (events.length === 0) break
      const olderThan = collected.length > 0 ? collected[0]!.event.seq : undefined
      const fresh = olderThan === undefined
        ? events
        : events.filter(entry => entry.event.seq < olderThan)
      if (boundarySeq !== undefined) {
        // Cached boundary + a window without the marker: the window is
        // entirely the child's own content — the seq filter is a safe no-op.
        const boundary = boundarySeq
        collected.unshift(...fresh.filter(entry => entry.event.seq > boundary))
        break
      }
      const boundaryIndex = fresh.findIndex(entry => isSideBoundaryEvent(entry.event))
      if (boundaryIndex >= 0) {
        for (let i = boundaryIndex - 1; i >= 0; i--) {
          if (fresh[i]?.event.type !== 'session/end-seed') continue
          boundarySeq = fresh[i]!.event.seq
          seedBoundaryCache.set(childSessionId, boundarySeq)
          break
        }
        collected.unshift(...fresh)
        break
      }
      const seedEnd = lastSeedEnd(fresh.map(entry => entry.event))
      if (seedEnd >= 0 && hasMore === false) {
        // Legacy/no-boundary logs have no stronger ownership marker.
        boundarySeq = fresh[seedEnd]!.event.seq
        seedBoundaryCache.set(childSessionId, boundarySeq)
        collected.unshift(...fresh.slice(seedEnd + 1))
        break
      }
      collected.unshift(...fresh)
      if (!hasMore) break
      if (fresh.length === 0) break
      beforeSeq = fresh[0]!.event.seq
    }
  } catch {
    return null
  }
  return [...collected, ...live]
}

/** Read durable events from the Remote journal envelopes. */
function expandHistoryRecords(records: readonly SessionHistoryRecord[]): TranscriptEntry[] {
  return records.map(record => ({ event: record.event as SessionEvent }))
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
  subagents: { prompt: (request: SubagentPromptRequest) => Promise<{ ok: boolean }> },
  address: Extract<SubagentAddress, { mode: 'continuable' }>,
  text: string,
): Promise<boolean> {
  try {
    const response = await subagents.prompt({
      requestId: crypto.randomUUID() as SubagentPromptRequestId,
      ...address,
      delivery: 'queue',
      content: [{ type: 'text', text }],
    })
    return response.ok === true
  } catch {
    return false
  }
}
