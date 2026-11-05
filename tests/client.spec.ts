/**
 * Unit tests for the dsh-sidechain browser half: the jump-target resolver and
 * the slot registration wiring (auto-open of created side conversations).
 */

import { describe, expect, it, vi } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { apply } from '../src/client/index'
import { observeCreatedChildren, resolveChildSessionId } from '../src/client/SideCommandCard'

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

describe('native sidebar integration', () => {
  it('opens only the visible parent and refreshes BTW takeover from the authoritative projection', () => {
    type Registration = { name: string; key?: string; id?: string; inject?: (id: string) => { openChild?: (id: string) => void }; select?: (owner: unknown) => unknown }
    const registered = new Set<Registration>()
    let refresh = () => {}
    let projections: Record<string, { values: { sidechainModes: Record<string, 'btw' | 'side'> } }> = {}
    let mounted = 'parent'
    const openResource = vi.fn()
    const ctx = {
      effect: (callback: () => void) => callback(), locale: { register: vi.fn() },
      uiConversation: { userText: { register: vi.fn() } },
      sidebarRight: { mounted: { getSnapshot: () => mounted }, openResource },
      sessions: {
        list: { getSnapshot: () => ({ projectionsBySession: projections }), subscribe: (callback: () => void) => { refresh = callback; return () => {} } },
        refreshProjections: vi.fn(),
      },
      slots: {
        inject: (_name: string, register: () => unknown) => register(),
        register: (options: Registration) => { registered.add(options); return () => { registered.delete(options) } },
      },
    }
    apply(ctx as never)
    const observer = [...registered].find(entry => entry.id === 'sidechain-native-observer')!
    const actions = observer.inject!('parent')
    actions.openChild!(CHILD_ID)
    expect(openResource).toHaveBeenCalledWith(expect.stringContaining(CHILD_ID), { kind: 'subagentchat', preferNewPane: true })
    mounted = 'different-parent'
    actions.openChild!(CHILD_ID)
    expect(openResource).toHaveBeenCalledTimes(1)
    const select = (pendingInteraction?: object) => [...registered].find(entry => entry.name === 'conversation.composer')!.select!({
      session: { subagent: { address: { parentSessionId: 'parent', childSessionId: CHILD_ID, mode: 'continuable' } } }, pendingInteraction,
    })
    expect(select()).toEqual({ parentId: 'parent', reason: 'loading' })
    const loadingRegistration = [...registered].find(entry => entry.name === 'conversation.composer')
    projections = {}
    refresh()
    expect([...registered].find(entry => entry.name === 'conversation.composer')).toBe(loadingRegistration)
    projections = { parent: { values: { sidechainModes: { [CHILD_ID]: 'btw' } } } }
    refresh()
    expect(select()).toEqual({ parentId: 'parent', reason: 'btw' })
    expect(select({ key: 'approval' })).toBeNull()
    projections = { parent: { values: { sidechainModes: { [CHILD_ID]: 'side' } } } }
    refresh()
    expect(select()).toBeNull()
    expect([...registered].filter(entry => entry.name === 'conversation.composer')).toHaveLength(1)
  })
})
