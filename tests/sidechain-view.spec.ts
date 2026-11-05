/**
 * Unit tests for the embedded side-conversation transcript model: event →
 * row mapping, tool call/result pairing, and the history/prompt RPC helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEventLike as SessionEvent } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import {
  blockText, fetchTranscript, mergeProduced, producedPaths, resetSeedBoundaryCache,
  resultViewSummary, sendPrompt, transcriptRows,
} from '../src/client/sidechain-view'
import type { TranscriptEntry } from '../src/client/sidechain-view'
import { sidePrompt } from '../src/side'
import { SIDE_PERSONA } from '../src/prompts'

import type { SessionId } from '@deepseek-ai/dsh-session/types'

const CHILD = '54c34e5e-1c29-4a6c-a2f7-4b19a3d92914' as SessionId
const ADDRESS: SubagentAddress = { parentSessionId: 'parent-1' as SessionId, childSessionId: CHILD, mode: 'continuable' }

function event(type: SessionEvent['type'], seq: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time: 0, data } as SessionEvent
}

/** Wrap events into expanded history rows. */
function ent(...events: SessionEvent[]): TranscriptEntry[] {
  return events.map(event => ({ event }))
}

describe('blockText', () => {
  it('joins text blocks with blank lines and skips non-text blocks', () => {
    expect(blockText([
      { type: 'text', text: '第一行' },
      { type: 'reasoning', text: '思考过程' },
      { type: 'text', text: '第二行' },
    ])).toBe('第一行\n\n第二行')
  })

  it('renders … for content without visible text', () => {
    expect(blockText([{ type: 'reasoning', text: 'hidden' }])).toBe('…')
    expect(blockText([])).toBe('…')
  })
})

describe('transcriptRows', () => {
  it('maps user prompts, assistant answers, and tool calls in order', () => {
    const rows = transcriptRows(ent(
      event('user/message', 1, { content: [{ type: 'text', text: '查一下' }] }),
      event('tool/call', 2, { name: 'grep', arguments: '{}' }),
      event('tool/result', 3, { message: { content: [] } }),
      event('assistant/message', 4, { message: { content: [{ type: 'text', text: '结果如下' }] } }),
    ))
    expect(rows).toEqual([
      { kind: 'user', seq: 1, text: '查一下' },
      { kind: 'tool', seq: 2, name: 'grep', failed: false, detail: { arguments: '{}' } },
      { kind: 'assistant', seq: 4, text: '结果如下' },
    ])
  })

  it('pairs a failing tool/result onto its call row by toolCallId', () => {
    const rows = transcriptRows(ent(
      event('tool/call', 1, { name: 'grep', arguments: '{}', callId: 'c1' }),
      event('tool/result', 2, {
        message: { toolCallId: 'c1', content: [] },
        error: { name: 'E', code: 'C' },
      }),
    ))
    expect(rows).toEqual([{
      kind: 'tool', seq: 1, name: 'grep', failed: true,
      detail: { arguments: '{}', error: { name: 'E', code: 'C' } },
    }])
  })

  it('marks a result failed on the block isError flag', () => {
    const rows = transcriptRows(ent(
      event('tool/call', 1, { name: 'edit', arguments: '{}', callId: 'c1' }),
      event('tool/result', 2, {
        message: { toolCallId: 'c1', content: [], isError: true },
      }),
    ))
    expect(rows[0]).toMatchObject({ kind: 'tool', failed: true })
  })

  it('keeps the error on orphan failed rows (expandable detail)', () => {
    const rows = transcriptRows(ent(
      event('tool/result', 1, {
        message: { toolCallId: 'c9', content: [] },
        error: { name: 'E', code: 'C' },
      }),
    ))
    expect(rows).toEqual([{
      kind: 'tool', seq: 1, name: 'tool', failed: true,
      detail: { error: { name: 'E', code: 'C' } },
    }])
  })

  it('attaches alpha tool-result content to the paired row', () => {
    const rows = transcriptRows([
      {
        event: event('tool/call', 1, { name: 'bash', arguments: '{}', callId: 'c1' }),
      },
      {
        event: event('tool/result', 2, {
          message: { toolCallId: 'c1', content: [{ type: 'text', text: 'src' }] },
        }),
      },
    ])
    expect(rows).toEqual([{
      kind: 'tool', seq: 1, name: 'bash', failed: false,
      detail: {
        arguments: '{}',
        result: [{ type: 'text', text: 'src' }],
      },
    }])
  })

  it('cuts the inherited fork seed at the last session/end-seed', () => {
    const rows = transcriptRows(ent(
      event('user/message', 1, { content: [{ type: 'text', text: '父会话的历史提问' }] }),
      event('session/end-seed', 2, {}),
      event('user/message', 3, { content: [{ type: 'text', text: '侧链提问' }] }),
      event('assistant/message', 4, { message: { content: [{ type: 'text', text: '侧链回答' }] } }),
    ))
    expect(rows).toEqual([
      { kind: 'user', seq: 3, text: '侧链提问' },
      { kind: 'assistant', seq: 4, text: '侧链回答' },
    ])
  })

  it('strips the boundary envelope and keeps the user question', () => {
    const rows = transcriptRows(ent(
      event('session/end-seed', 1, {}),
      event('user/message', 2, {
        content: sidePrompt('这个目录下哪个文件最大？', 'btw', [], SIDE_PERSONA),
      }),
      event('assistant/message', 3, { message: { content: [{ type: 'text', text: '好的' }] } }),
    ))
    expect(rows).toEqual([
      { kind: 'user', seq: 2, text: '这个目录下哪个文件最大？' },
      { kind: 'assistant', seq: 3, text: '好的' },
    ])
  })

  it('accumulates text-delta chunks into a streaming row and supersedes it with the assembled message', () => {
    const stream = transcriptRows(ent(
      event('session/end-seed', 1, {}),
      event('assistant/live-chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '你好' } }),
      event('assistant/live-chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '，世界' } }),
    ))
    expect(stream).toEqual([{ kind: 'assistant', seq: 2, text: '你好，世界' }])
    const settled = transcriptRows(ent(
      event('session/end-seed', 1, {}),
      event('assistant/live-chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '你好' } }),
      event('assistant/live-chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '，世界' } }),
      event('assistant/message', 4, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '你好，世界！' }] } }),
    ))
    expect(settled).toEqual([{ kind: 'assistant', seq: 4, text: '你好，世界！' }])
  })

  it('ignores reasoning deltas and non-text chunks', () => {
    const rows = transcriptRows(ent(
      event('session/end-seed', 1, {}),
      event('assistant/live-chunk', 2, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '思考中' } }),
      event('assistant/live-chunk', 3, { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 0, id: 'c1', argumentsDelta: '{}' } }),
      event('assistant/live-chunk', 4, { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } }),
      event('assistant/message', 5, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '最终答案' }] } }),
    ))
    expect(rows).toEqual([{ kind: 'assistant', seq: 5, text: '最终答案' }])
  })

  it('skips log detail events (turn brackets, usage chunks, projections)', () => {
    const rows = transcriptRows(ent(
      event('turn/start', 1, { turn: 1 }),
      event('assistant/live-chunk', 2, { turn: 1, step: 1, chunk: { type: 'usage', usage: {} } }),
      event('turn/end', 3, { turn: 1, reason: 'stop' }),
      event('session/end-seed', 4, {}),
    ))
    expect(rows).toEqual([])
  })

  it('surfaces a failed turn so one-shot errors are visible', () => {
    const rows = transcriptRows(ent(
      event('session/end-seed', 1, {}),
      event('turn/end', 2, {
        turn: 1,
        reason: { kind: 'error', error: { message: 'model unavailable', code: 'MODEL_NOT_FOUND' } },
      }),
    ))
    expect(rows).toEqual([{ kind: 'error', seq: 2, text: 'model unavailable' }])
  })
})

describe('resultViewSummary', () => {
  it('summarizes alpha tool-result content', () => {
    expect(resultViewSummary([{ type: 'text', text: '结果' }])).toBe('结果')
    expect(resultViewSummary([])).toBeUndefined()
  })
})

describe('producedPaths', () => {
  it('collects diff and edit-call locations in first-seen order, deduped', () => {
    const entries = [
      { event: event('tool/call', 1, { name: 'write', arguments: '{"file_path":"src/a.ts"}' }) },
      { event: event('tool/call', 2, { name: 'edit', arguments: '{"file_path":"src/b.ts","path":"src/a.ts"}' }) },
      { event: event('tool/call', 3, { name: 'read', arguments: '{"path":"src/c.ts"}' }) },
    ]
    expect(producedPaths(entries)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('cuts the inherited seed and excludes failed calls', () => {
    const entries = [
      { event: event('tool/call', 1, { name: 'write', arguments: '{"file_path":"parent-only.ts"}', callId: 'p1' }) },
      { event: event('session/end-seed', 2, {}) },
      { event: event('tool/call', 3, { name: 'write', arguments: '{"file_path":"failed.ts"}', callId: 'c1' }) },
      { event: event('tool/result', 4, { message: { toolCallId: 'c1', content: [] }, error: { name: 'E', code: 'C' } }) },
      { event: event('tool/call', 5, { name: 'write', arguments: '{"file_path":"made.ts"}', callId: 'c2' }) },
      { event: event('tool/result', 6, { message: { toolCallId: 'c2', content: [] } }) },
    ]
    expect(producedPaths(entries)).toEqual(['made.ts'])
  })

  it('ignores missing paths and non-mutation kinds', () => {
    const entries = [
      { event: event('tool/call', 1, { name: 'x', arguments: '{}' }) },
      { event: event('tool/call', 2, { name: 'y', arguments: '{}' }) },
      { event: event('tool/call', 3, { name: 'z', arguments: '{"path":"z.ts"}' }) },
    ]
    expect(producedPaths(entries)).toEqual([])
  })
})

describe('mergeProduced', () => {
  it('unions vocabularies in first-seen order, deduped', () => {
    expect(mergeProduced(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(mergeProduced([], ['a'])).toEqual(['a'])
  })
})

describe('fetchTranscript', () => {
  beforeEach(() => {
    // The seed-boundary cache is module-scoped; each test starts clean.
    resetSeedBoundaryCache()
  })

  const record = (event: SessionEvent): { type: 'event'; event: SessionEvent } => ({ type: 'event', event })
  const snapshot = (records: readonly { type: 'event'; event: SessionEvent }[], hasMore: boolean) => ({
    type: 'snapshot' as const, cursor: 200, records, hasMore, header: {}, projections: {},
  })
  const remote = (
    followSnapshots: readonly ReturnType<typeof snapshot>[],
    pages: readonly { records: readonly { type: 'event'; event: SessionEvent }[]; hasMore: boolean }[],
  ) => {
    const followQueue = [...followSnapshots]
    const pageQueue = [...pages]
    const follow = vi.fn(async function* () { yield followQueue.shift()! })
    const page = vi.fn(async () => ({ ok: true as const, value: pageQueue.shift()! }))
    return { follow, page }
  }

  it('maps the alpha follow snapshot to transcript rows', async () => {
    const sessions = remote([snapshot([
      record(event('user/message', 1, { content: [{ type: 'text', text: '嗨' }] })),
      record(event('assistant/message', 2, { message: { content: [{ type: 'text', text: '你好' }] } })),
    ], false)], [])
    const result = await fetchTranscript(sessions as never, ADDRESS)
    expect(sessions.follow).toHaveBeenCalledWith({
      address: { kind: 'subagent', parentSessionId: ADDRESS.parentSessionId, childSessionId: CHILD, mode: 'continuable' },
      maxMessages: 8,
      assistantStream: true,
    })
    expect(result).toEqual({
      rows: [
        { kind: 'user', seq: 1, text: '嗨' },
        { kind: 'assistant', seq: 2, text: '你好' },
      ],
      produced: [],
    })
  })

  it('replaces transient snapshot text with the committed answer without retaining stale chunks', async () => {
    const opening = {
      ...snapshot([record(event('session/end-seed', 1, {}))], false),
      assistantStream: { revision: 1, activeAttempt: {
        attemptId: 'attempt-1', startedAfterSeq: 1, turn: 1, step: 1, nextIndex: 2,
        stream: [{ type: 'text-chunks', time0: 0, index: 0, dt: [1], texts: ['你', '好'] }],
      } },
    }
    const sessions = remote([opening, snapshot([
      record(event('assistant/message', 2, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '你好，完成' }] } })),
    ], false)], [])
    const streaming = await fetchTranscript(sessions as never, ADDRESS)
    expect(streaming?.rows.map(row => 'text' in row ? row.text : '')).toEqual(['你好'])
    const settled = await fetchTranscript(sessions as never, ADDRESS)
    expect(settled?.rows.map(row => 'text' in row ? row.text : '')).toEqual(['你好，完成'])
  })

  it('walks backward to the seed boundary and cuts the inherited fork seed', async () => {
    // Page 1 (tail): a continuation marker followed by the newest turn.
    const sessions = remote([snapshot([
      record(event('session/end-seed', 100, {})),
      record(event('user/message', 110, { content: [{ type: 'text', text: '第二问' }] })),
      record(event('assistant/message', 111, { message: { content: [{ type: 'text', text: '第二个答案' }] } })),
    ], true)], [{
      records: [
        record(event('session/end-seed', 80, {})),
        record(event('user/message', 81, { content: [{ type: 'text', text: 'Side conversation boundary' }] })),
        record(event('user/message', 90, { content: [{ type: 'text', text: '第一问' }] })),
        record(event('assistant/message', 91, { message: { content: [{ type: 'text', text: '第一个答案' }] } })),
      ], hasMore: false,
    }])
    const result = await fetchTranscript(sessions as never, ADDRESS)
    expect(sessions.page).toHaveBeenCalledWith(expect.objectContaining({ throughSeq: 200, beforeSeq: 100 }))
    // Only the child's own conversation survives the cut.
    expect(result).toEqual({
      rows: [
        { kind: 'user', seq: 90, text: '第一问' },
        { kind: 'assistant', seq: 91, text: '第一个答案' },
        { kind: 'user', seq: 110, text: '第二问' },
        { kind: 'assistant', seq: 111, text: '第二个答案' },
      ],
      produced: [],
    })
  })

  it('dedupes overlapping page boundaries when the host page is inclusive', async () => {
    const sessions = remote([snapshot([
      record(event('user/message', 90, { content: [{ type: 'text', text: '旧问' }] })),
      record(event('user/message', 92, { content: [{ type: 'text', text: '问' }] })),
    ], true)], [{
      records: [record(event('session/end-seed', 80, {})), record(event('user/message', 90, { content: [{ type: 'text', text: '旧问' }] }))],
      hasMore: false,
    }])
    const result = await fetchTranscript(sessions as never, ADDRESS)
    expect(result).toEqual({
      rows: [
        { kind: 'user', seq: 90, text: '旧问' },
        { kind: 'user', seq: 92, text: '问' },
      ],
      produced: [],
    })
  })

  it('reuses the cached seed boundary — later reads fetch one page only', async () => {
    // First read: the walk locates the boundary (page 2 has the end-seed).
    const sessions = remote([
      snapshot([record(event('user/message', 90, { content: [{ type: 'text', text: '旧问' }] })), record(event('assistant/message', 91, { message: { content: [{ type: 'text', text: '旧答' }] } }))], true),
      snapshot([record(event('user/message', 92, { content: [{ type: 'text', text: '新问' }] })), record(event('assistant/message', 93, { message: { content: [{ type: 'text', text: '新答' }] } }))], false),
    ], [{ records: [record(event('session/end-seed', 80, {})), record(event('user/message', 81, { content: [{ type: 'text', text: 'Side conversation boundary' }] }))], hasMore: false }])
    const first = await fetchTranscript(sessions as never, ADDRESS)
    expect(first).toEqual({
      rows: [
        { kind: 'user', seq: 90, text: '旧问' },
        { kind: 'assistant', seq: 91, text: '旧答' },
      ],
      produced: [],
    })
    expect(sessions.page).toHaveBeenCalledWith(expect.objectContaining({ beforeSeq: 90 }))
    // Cached: exactly one fetch, no beforeSeq walk.
    const second = await fetchTranscript(sessions, ADDRESS)
    expect(sessions.follow).toHaveBeenCalledTimes(2)
    expect(second).toEqual({
      rows: [
        { kind: 'user', seq: 90, text: '旧问' },
        { kind: 'assistant', seq: 91, text: '旧答' },
        { kind: 'user', seq: 92, text: '新问' },
        { kind: 'assistant', seq: 93, text: '新答' },
      ],
      produced: [],
    })
  })

  it('extracts produced files from alpha tool arguments', async () => {
    const sessions = remote([snapshot([record(event('tool/call', 1, { name: 'write', arguments: '{"file_path":"/w/src/a.ts"}' }))], false)], [])
    const result = await fetchTranscript(sessions as never, ADDRESS)
    expect(result).toEqual({
      rows: [{
        kind: 'tool', seq: 1, name: 'write', failed: false,
        detail: { arguments: '{"file_path":"/w/src/a.ts"}' },
      }],
      produced: ['/w/src/a.ts'],
    })
  })

  it('hydrates child images using the full attachment reference and legacy identity', async () => {
    const attachment = { attachmentId: 'image-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1 }
    const sessions = {
      ...remote([snapshot([
        record(event('assistant/message', 1, { message: { content: [{ type: 'image', attachment }] } })),
      ], false)], []),
      attachment: vi.fn(async (request) => ({
        ok: request.attachment?.bytes === attachment.bytes && request.attachmentId === attachment.attachmentId,
        value: { attachment, data: 'aW1n' },
      })),
    }
    const result = await fetchTranscript(sessions as never, ADDRESS)
    expect(sessions.attachment).toHaveBeenCalledWith({ sessionId: CHILD, attachment, attachmentId: attachment.attachmentId })
    expect(result?.rows[0]).toMatchObject({ images: [{ attachment, url: 'data:image/png;base64,aW1n' }] })
  })

  it('returns null on business failure', async () => {
    const follow = vi.fn(async function* () { yield { type: 'error' as const } as never })
    expect(await fetchTranscript({ follow } as never, ADDRESS)).toBeNull()
  })

  it('returns null on transport failure', async () => {
    const follow = vi.fn(async function* () { throw new Error('network') })
    expect(await fetchTranscript({ follow } as never, ADDRESS)).toBeNull()
  })
})

describe('sendPrompt', () => {
  it('delivers a text block through subagent.prompt', async () => {
    const prompt = vi.fn(() => Promise.resolve({ ok: true }))
    const accepted = await sendPrompt({ prompt } as never, ADDRESS, '继续')
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      ...ADDRESS,
      content: [{ type: 'text', text: '继续' }],
      requestId: expect.any(String),
    }))
    expect(accepted).toBe(true)
  })

  it('returns false on rejection', async () => {
    const prompt = vi.fn(() => Promise.resolve({ ok: false }))
    expect(await sendPrompt({ prompt } as never, ADDRESS, '继续')).toBe(false)
  })
})
