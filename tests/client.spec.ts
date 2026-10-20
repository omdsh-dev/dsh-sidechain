/**
 * Unit tests for the dsh-sidechain browser half: the jump-target resolver and
 * the slot registration wiring (auto-open of created side conversations).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { apply } from '../src/client/index'
import { observeCreatedChildren, resolveChildSessionId } from '../src/client/SideCommandCard'
import { SIDECHAIN_STYLE_CSS } from '../src/client/panel-style'
import { resetSidechainPanel } from '../src/client/panel-state'

const CHILD_ID = '54c34e5e-1c29-4a6c-a2f7-4b19a3d92914'

function node(partial: Partial<CommandNode> = {}): CommandNode {
  return {
    kind: 'command',
    seq: 1,
    time: 0,
    commandId: 'cmd-1' as CommandNode['commandId'],
    name: 'side',
    args: null,
    outcome: null,
    ...partial,
  }
}

describe('resolveChildSessionId', () => {
  it('resolves /side success text', () => {
    expect(resolveChildSessionId(node({
      name: 'side',
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    }), 'side')).toBe(CHILD_ID)
  })

  it('resolves /btw success text with the started marker', () => {
    expect(resolveChildSessionId(node({
      name: 'btw',
      outcome: { kind: 'success', text: `BTW question started: ${CHILD_ID}.` },
    }), 'btw')).toBe(CHILD_ID)
  })

  it('returns undefined on malformed text', () => {
    expect(resolveChildSessionId(node({ outcome: { kind: 'success', text: 'no id here' } }), 'side')).toBeUndefined()
    expect(resolveChildSessionId(node({ outcome: { kind: 'success', text: 'plain answer' } }), 'btw')).toBeUndefined()
  })
})

describe('observeCreatedChildren', () => {
  it('ignores commands already settled when the observer mounts', () => {
    const initial = observeCreatedChildren(undefined, [node({
      time: 20,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    })], 10)
    expect(initial.children).toEqual([])
  })

  it('reveals a fast command that appears already settled after mount', () => {
    const initial = observeCreatedChildren(undefined, [], 10)
    const settled = observeCreatedChildren(initial.known, [node({
      time: 20,
      name: 'btw',
      outcome: { kind: 'success', text: `BTW question started: ${CHILD_ID}.` },
    })], 10)
    expect(settled.children).toEqual([CHILD_ID])
  })

  it('ignores old replay rows that arrive after an initially empty history snapshot', () => {
    const initial = observeCreatedChildren(undefined, [], 20)
    const replay = observeCreatedChildren(initial.known, [node({
      time: 10,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    })], 20)
    expect(replay.children).toEqual([])
  })

  it('reveals a command when it transitions from pending to success exactly once', () => {
    const initial = observeCreatedChildren(undefined, [], 10)
    const pending = observeCreatedChildren(initial.known, [node({ time: 20 })], 10)
    expect(pending.children).toEqual([])
    const settled = observeCreatedChildren(pending.known, [node({
      time: 20,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    })], 10)
    expect(settled.children).toEqual([CHILD_ID])
    expect(observeCreatedChildren(settled.known, [node({
      time: 20,
      outcome: { kind: 'success', text: `Side conversation started: ${CHILD_ID}.` },
    })], 10).children).toEqual([])
  })

  it('does not reveal running, failed, or unrelated commands', () => {
    const initial = observeCreatedChildren(undefined, [], 10)
    const observed = observeCreatedChildren(initial.known, [
      node({ time: 20 }),
      node({ time: 20, commandId: 'cmd-2' as CommandNode['commandId'], outcome: { kind: 'error', text: 'boom' } }),
      node({ time: 20, commandId: 'cmd-3' as CommandNode['commandId'], name: 'compact', outcome: { kind: 'success' } }),
    ], 10)
    expect(observed.children).toEqual([])
  })
})

describe('client apply wiring', () => {
  interface RegisteredSlot {
    options: {
      name: string
      key?: string
      id?: string
      order?: number
      locale?: string
      inject?: (parentSessionId: string) => {
        revealPanel?: (childSessionId: string) => void
        readTranscript?: (address: unknown) => Promise<unknown>
        readActivity?: (address: unknown) => Promise<unknown>
        sendPrompt?: (address: unknown, text: string) => Promise<boolean>
        refresh?: (parentSessionId: string) => void
        openPath?: (path: string) => void
      }
    }
  }

  beforeEach(() => {
    resetSidechainPanel()
  })

  function fakeCtx() {
    const registered: RegisteredSlot[] = []
    const refreshProjections = vi.fn(() => Promise.resolve())
    const registerLocale = vi.fn()
    const follow = vi.fn(async function* () {
      yield { type: 'snapshot' as const, cursor: 0, records: [], hasMore: false, header: {}, projections: {} }
    })
    const page = vi.fn(() => Promise.resolve({ ok: true as const, value: { records: [], hasMore: false } }))
    const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { messageId: 'm' } }))
    const remote = {
      session: { follow, page, attachment: vi.fn(), openWorkspacePath: vi.fn() },
      subagents: { prompt },
    }
    const ctx = {
      sessions: { refreshProjections },
      locale: { register: registerLocale },
      effect: (fn: () => void) => { fn() },
      remote,
      slots: {
        register: (options: RegisteredSlot['options'], _component: unknown) => {
          registered.push({ options })
          return () => {}
        },
        // The real runtime waits for the slot declaration before running the
        // register callback; the declaration exists in this test context.
        inject: (_name: string, register: () => () => void) => {
          register()
        },
      },
    }
    return { ctx, registered, follow, page, prompt, refreshProjections }
  }

  it('registers keyed cards, an always-mounted panel host, and the header toggle', () => {
    const { ctx, registered } = fakeCtx()
    apply(ctx as never)
    expect(registered.map(entry => [entry.options.name, entry.options.key ?? entry.options.id]))
      .toEqual([
        ['conversation.chat.commandview', 'side'],
        ['conversation.chat.commandview', 'btw'],
        ['conversation.input.dock', 'sidechain-panel-host'],
        ['conversation.session.header.actions', 'sidechain-panel-toggle'],
      ])
  })

  it('panel inject wires the transcript RPC and catalog methods', async () => {
    const { ctx, registered, follow, prompt, refreshProjections } = fakeCtx()
    apply(ctx as never)
    const entry = registered.find(item => item.options.id === 'sidechain-panel-host')!
    const injected = entry.options.inject!('parent-1')
    const address = { parentSessionId: 'parent-1', childSessionId: CHILD_ID, mode: 'continuable' }
    const transcript = await injected.readTranscript!(address)
    expect(follow).toHaveBeenCalledWith({
      address: { kind: 'subagent', parentSessionId: 'parent-1', childSessionId: CHILD_ID, mode: 'continuable' },
      maxMessages: 8,
      assistantStream: true,
    })
    expect(transcript).toEqual({ rows: [], produced: [] })
    // The activity line reads a lighter tail page; an empty log yields null.
    const activityLine = await injected.readActivity!(address)
    expect(follow).toHaveBeenCalledWith({
      address: { kind: 'subagent', parentSessionId: 'parent-1', childSessionId: CHILD_ID, mode: 'continuable' },
      maxMessages: 6,
      assistantStream: true,
    })
    expect(activityLine).toBeNull()
    const accepted = await injected.sendPrompt!(address, '继续')
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      ...address, content: [{ type: 'text', text: '继续' }], requestId: expect.any(String),
    }))
    expect(accepted).toBe(true)
    injected.refresh!('parent-1')
    expect(refreshProjections).toHaveBeenCalledWith('parent-1')
  })
})

describe('panel chrome under the desktop window shell', () => {
  it('starts the panel below the Windows titlebar drag band', () => {
    // Chromium routes pointer events inside `-webkit-app-region: drag` to the
    // window frame, so a top:0 panel had its header (返回列表 included) in a
    // band where clicks never reached the page.
    expect(SIDECHAIN_STYLE_CSS).toContain('html[data-windows-titlebar] .dsh-sidechain-panel')
    expect(SIDECHAIN_STYLE_CSS).toContain('var(--dsh-windows-titlebar-height, 0px)')
  })

  it('carves the panel out of any remaining window drag region', () => {
    expect(SIDECHAIN_STYLE_CSS).toContain('-webkit-app-region: no-drag')
  })
})
