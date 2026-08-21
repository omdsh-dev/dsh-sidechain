/**
 * Unit tests for the embedded side-conversation transcript model: event →
 * row mapping, tool call/result pairing, and the history/prompt RPC helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-client-connection/client'
import {
  blockText, fetchTranscript, mergeProduced, producedPaths, resetSeedBoundaryCache,
  resultViewSummary, sendPrompt, transcriptRows,
} from '../src/client/sidechain-view'
import type { TranscriptEntry } from '../src/client/sidechain-view'

import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'

const CHILD = '54c34e5e-1c29-4a6c-a2f7-4b19a3d92914' as SessionId
const ADDRESS: SubagentAddress = { parentSessionId: 'parent-1' as SessionId, childSessionId: CHILD, mode: 'continuable' }

function event(type: SessionEvent['type'], seq: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time: 0, data } as SessionEvent
}

/** Wrap events into history rows (views absent unless provided). */
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
        message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] },
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
        message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [], isError: true }] },
      }),
    ))
    expect(rows[0]).toMatchObject({ kind: 'tool', failed: true })
  })

  it('keeps the error on orphan failed rows (expandable detail)', () => {
    const rows = transcriptRows(ent(
      event('tool/result', 1, {
        message: { content: [{ type: 'tool-result', toolCallId: 'c9', content: [] }] },
        error: { name: 'E', code: 'C' },
      }),
    ))
    expect(rows).toEqual([{
      kind: 'tool', seq: 1, name: 'tool', failed: true,
      detail: { error: { name: 'E', code: 'C' } },
    }])
  })

  it('attaches the call and result views to the paired row', () => {
    const rows = transcriptRows([
      {
        event: event('tool/call', 1, { name: 'bash', arguments: '{}', callId: 'c1' }),
        view: { for: 'call', view: { card: 'terminal', title: 'ls' } },
      },
      {
        event: event('tool/result', 2, {
          message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] },
        }),
        view: { for: 'result', view: { card: 'terminal', title: 'ls', output: 'src\n', exitCode: 0 } },
      },
    ])
    expect(rows).toEqual([{
      kind: 'tool', seq: 1, name: 'bash', failed: false,
      detail: {
        arguments: '{}',
        callView: { card: 'terminal', title: 'ls' },
        resultView: { card: 'terminal', title: 'ls', output: 'src\n', exitCode: 0 },
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
        content: [{ type: 'text', text: 'Side conversation boundary.\n\nEverything before this boundary is reference context only.\n\nMode: this is a /btw one-shot side question. Answer once.\n\n这个目录下哪个文件最大？' }],
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
      event('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '你好' } }),
      event('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '，世界' } }),
    ))
    expect(stream).toEqual([{ kind: 'assistant', seq: 2, text: '你好，世界' }])
    const settled = transcriptRows(ent(
      event('session/end-seed', 1, {}),
      event('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '你好' } }),
      event('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '，世界' } }),
      event('assistant/message', 4, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '你好，世界！' }] } }),
    ))
    expect(settled).toEqual([{ kind: 'assistant', seq: 4, text: '你好，世界！' }])
  })

  it('ignores reasoning deltas and non-text chunks', () => {
    const rows = transcriptRows(ent(
      event('session/end-seed', 1, {}),
      event('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '思考中' } }),
      event('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 0, id: 'c1', argumentsDelta: '{}' } }),
      event('assistant/chunk', 4, { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } }),
      event('assistant/message', 5, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '最终答案' }] } }),
    ))
    expect(rows).toEqual([{ kind: 'assistant', seq: 5, text: '最终答案' }])
  })

  it('skips log detail events (turn brackets, usage chunks, projections)', () => {
    const rows = transcriptRows(ent(
      event('turn/start', 1, { turn: 1 }),
      event('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'usage', usage: {} } }),
      event('turn/end', 3, { turn: 1, reason: 'stop' }),
      event('session/end-seed', 4, {}),
    ))
    expect(rows).toEqual([])
  })
})

describe('resultViewSummary', () => {
  it('summarizes diff, read, search, and web views', () => {
    expect(resultViewSummary({ card: 'diff', diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y\nz' }] }))
      .toBe('a.ts · 3 行变更')
    expect(resultViewSummary({ card: 'read', path: 'a.ts', offset: 1, lines: [{ number: 1, text: 'x' }], totalLines: 10 }))
      .toBe('a.ts · 显示 1/10 行')
    expect(resultViewSummary({ card: 'search', shape: 'paths', truncated: false, total: 2, paths: ['a.ts', 'b.ts'] }))
      .toBe('2 个路径')
    expect(resultViewSummary({
      card: 'search', shape: 'matches', truncated: false, total: 1,
      files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'x' }] }],
    })).toBe('1 个文件 · 1 处匹配')
    expect(resultViewSummary({ card: 'web', kind: 'search', sources: [{ url: 'https://x' }], truncated: false }))
      .toBe('1 个来源')
    expect(resultViewSummary({ card: 'web', kind: 'fetch', url: 'https://x', statusCode: 200, truncated: false }))
      .toBe('https://x · HTTP 200')
    expect(resultViewSummary({ card: 'generic', content: [{ type: 'text', text: '结果' }] })).toBe('结果')
    expect(resultViewSummary({ card: 'terminal', output: 'x' })).toBeUndefined()
  })
})

describe('producedPaths', () => {
  it('collects diff and edit-call locations in first-seen order, deduped', () => {
    const entries = [
      { event: event('tool/call', 1, { name: 'write', arguments: '{}' }), view: { for: 'call' as const, view: { card: 'diff' as const, title: 'Write a', diffs: [], locations: [{ path: 'src/a.ts' }] } } },
      { event: event('tool/call', 2, { name: 'edit', arguments: '{}' }), view: { for: 'call' as const, view: { card: 'generic' as const, title: 'Edit', kind: 'edit' as const, locations: [{ path: 'src/b.ts' }, { path: 'src/a.ts' }] } } },
      { event: event('tool/call', 3, { name: 'read', arguments: '{}' }), view: { for: 'call' as const, view: { card: 'generic' as const, title: 'Read', kind: 'read' as const, locations: [{ path: 'src/c.ts' }] } } },
    ]
    expect(producedPaths(entries)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('cuts the inherited seed and excludes failed calls', () => {
    const entries = [
      { event: event('tool/call', 1, { name: 'write', arguments: '{}', callId: 'p1' }), view: { for: 'call' as const, view: { card: 'diff' as const, title: 'p', diffs: [], locations: [{ path: 'parent-only.ts' }] } } },
      { event: event('session/end-seed', 2, {}) },
      { event: event('tool/call', 3, { name: 'write', arguments: '{}', callId: 'c1' }), view: { for: 'call' as const, view: { card: 'diff' as const, title: 'c', diffs: [], locations: [{ path: 'failed.ts' }] } } },
      { event: event('tool/result', 4, { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] }, error: { name: 'E', code: 'C' } }) },
      { event: event('tool/call', 5, { name: 'write', arguments: '{}', callId: 'c2' }), view: { for: 'call' as const, view: { card: 'diff' as const, title: 'c', diffs: [], locations: [{ path: 'made.ts' }] } } },
      { event: event('tool/result', 6, { message: { content: [{ type: 'tool-result', toolCallId: 'c2', content: [] }] } }) },
    ]
    expect(producedPaths(entries)).toEqual(['made.ts'])
  })

  it('ignores result views, missing views, and non-mutation kinds', () => {
    const entries = [
      { event: event('tool/call', 1, { name: 'x', arguments: '{}' }), view: { for: 'result' as const, view: { card: 'diff' as const, title: 'x', diffs: [] } } },
      { event: event('tool/call', 2, { name: 'y', arguments: '{}' }) },
      { event: event('tool/call', 3, { name: 'z', arguments: '{}' }), view: { for: 'call' as const, view: { card: 'generic' as const, title: 'z', kind: 'execute' as const } } },
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

  it('maps the seed-cut history tail to rows via session.history', async () => {
    const history = vi.fn(() => Promise.resolve({
      result: {
        ok: true,
        value: {
          events: [
            { event: event('user/message', 1, { content: [{ type: 'text', text: '嗨' }] }) },
            { event: event('assistant/message', 2, { message: { content: [{ type: 'text', text: '你好' }] } }) },
          ],
          hasMore: false,
        },
      },
    }))
    const result = await fetchTranscript({ history } as never, ADDRESS)
    expect(history).toHaveBeenCalledWith({ sessionId: CHILD, maxMessages: 8 })
    expect(result).toEqual({
      rows: [
        { kind: 'user', seq: 1, text: '嗨' },
        { kind: 'assistant', seq: 2, text: '你好' },
      ],
      produced: [],
    })
  })

  it('walks backward to the seed boundary and cuts the inherited fork seed', async () => {
    // Page 1 (tail): the child's own conversation, no end-seed.
    const history = vi.fn()
      .mockResolvedValueOnce({
        result: {
          ok: true,
          value: {
            events: [
              { event: event('user/message', 90, { content: [{ type: 'text', text: '第二问' }] }) },
              { event: event('assistant/message', 91, { message: { content: [{ type: 'text', text: '第二个答案' }] } }) },
            ],
            hasMore: false,
          },
        },
      })
      // Page 2 (older): inherited seed + the boundary marker.
      .mockResolvedValueOnce({
        result: {
          ok: true,
          value: {
            events: [
              { event: event('session/end-seed', 80, {}) },
              { event: event('user/message', 81, { content: [{ type: 'text', text: 'Side conversation boundary' }] }) },
            ],
            hasMore: false,
          },
        },
      })
    const result = await fetchTranscript({ history } as never, ADDRESS)
    expect(history).toHaveBeenNthCalledWith(1, { sessionId: CHILD, maxMessages: 8 })
    expect(history).toHaveBeenNthCalledWith(2, { sessionId: CHILD, maxMessages: 8, beforeSeq: 90 })
    // Only the child's own conversation survives the cut.
    expect(result).toEqual({
      rows: [
        { kind: 'user', seq: 90, text: '第二问' },
        { kind: 'assistant', seq: 91, text: '第二个答案' },
      ],
      produced: [],
    })
  })

  it('dedupes overlapping page boundaries when the host page is inclusive', async () => {
    const history = vi.fn()
      .mockResolvedValueOnce({
        result: { ok: true, value: {
          events: [
            { event: event('user/message', 90, { content: [{ type: 'text', text: '旧问' }] }) },
            { event: event('user/message', 92, { content: [{ type: 'text', text: '问' }] }) },
          ],
          hasMore: false,
        } },
      })
      // Overlapping page: repeats seq 90 before the seed boundary.
      .mockResolvedValueOnce({
        result: { ok: true, value: {
          events: [
            { event: event('session/end-seed', 80, {}) },
            { event: event('user/message', 90, { content: [{ type: 'text', text: '旧问' }] }) },
          ],
          hasMore: false,
        } },
      })
    const result = await fetchTranscript({ history } as never, ADDRESS)
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
    const history = vi.fn()
      .mockResolvedValueOnce({
        result: { ok: true, value: {
          events: [
            { event: event('user/message', 90, { content: [{ type: 'text', text: '旧问' }] }) },
            { event: event('assistant/message', 91, { message: { content: [{ type: 'text', text: '旧答' }] } }) },
          ],
          hasMore: false,
        } },
      })
      .mockResolvedValueOnce({
        result: { ok: true, value: {
          events: [
            { event: event('session/end-seed', 80, {}) },
            { event: event('user/message', 81, { content: [{ type: 'text', text: 'Side conversation boundary' }] }) },
          ],
          hasMore: false,
        } },
      })
      // Second read (cached): the tail window has no end-seed, but the cached
      // boundary supplies the cut — one page, no walk.
      .mockResolvedValueOnce({
        result: { ok: true, value: {
          events: [
            { event: event('user/message', 92, { content: [{ type: 'text', text: '新问' }] }) },
            { event: event('assistant/message', 93, { message: { content: [{ type: 'text', text: '新答' }] } }) },
          ],
          hasMore: false,
        } },
      })
    const sessions = { history } as never
    const first = await fetchTranscript(sessions, ADDRESS)
    expect(first).toEqual({
      rows: [
        { kind: 'user', seq: 90, text: '旧问' },
        { kind: 'assistant', seq: 91, text: '旧答' },
      ],
      produced: [],
    })
    expect(history).toHaveBeenNthCalledWith(2, { sessionId: CHILD, maxMessages: 8, beforeSeq: 90 })
    // Cached: exactly one fetch, no beforeSeq walk.
    const second = await fetchTranscript(sessions, ADDRESS)
    expect(history).toHaveBeenCalledTimes(3)
    expect(history).toHaveBeenNthCalledWith(3, { sessionId: CHILD, maxMessages: 8 })
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

  it('extracts the produced-file vocabulary from call views', async () => {
    const history = vi.fn(() => Promise.resolve({
      result: {
        ok: true,
        value: {
          events: [
            {
              event: event('tool/call', 1, { name: 'write', arguments: '{}' }),
              view: { for: 'call', view: { card: 'diff', title: 'w', diffs: [], locations: [{ path: '/w/src/a.ts' }] } },
            },
          ],
          hasMore: false,
        },
      },
    }))
    const result = await fetchTranscript({ history } as never, ADDRESS)
    expect(result).toEqual({
      rows: [{
        kind: 'tool', seq: 1, name: 'write', failed: false,
        detail: { arguments: '{}', callView: { card: 'diff', title: 'w', diffs: [], locations: [{ path: '/w/src/a.ts' }] } },
      }],
      produced: ['/w/src/a.ts'],
    })
  })

  it('returns null on business failure', async () => {
    const history = vi.fn(() => Promise.resolve({ result: { ok: false, error: { code: 'x', message: 'x' } } }))
    expect(await fetchTranscript({ history } as never, ADDRESS)).toBeNull()
  })

  it('returns null on transport failure', async () => {
    const history = vi.fn(() => Promise.reject(new Error('network')))
    expect(await fetchTranscript({ history } as never, ADDRESS)).toBeNull()
  })
})

describe('sendPrompt', () => {
  it('delivers a text block through subagent.prompt', async () => {
    const prompt = vi.fn(() => Promise.resolve({ result: { ok: true } }))
    const accepted = await sendPrompt({ prompt } as never, ADDRESS, '继续')
    expect(prompt).toHaveBeenCalledWith({
      ...ADDRESS,
      content: [{ type: 'text', text: '继续' }],
    })
    expect(accepted).toBe(true)
  })

  it('returns false on rejection', async () => {
    const prompt = vi.fn(() => Promise.resolve({ result: { ok: false, error: { code: 'x', message: 'x' } } }))
    expect(await sendPrompt({ prompt } as never, ADDRESS, '继续')).toBe(false)
  })
})
