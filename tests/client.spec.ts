/**
 * Unit tests for the dsh-sidechain browser half: the jump-target resolver and
 * the slot registration wiring (auto-open of created side conversations).
 */

import { describe, expect, it, vi } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MenuState } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SlotCore, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply } from '../src/client/index'
import { observeCreatedChildren, resolveChildSessionId } from '../src/client/SideCommandCard'
import { installCommandMenu, localizeCommandMenu } from '../src/client/command-menu'
import { en, zh } from '../src/client/locales'

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
      effect: (callback: () => void) => callback(), locale: { register: vi.fn(), bind: vi.fn() },
      uiConversation: { userText: { register: vi.fn() } },
      sidebarRight: { mounted: { getSnapshot: () => mounted }, openResource },
      sessions: {
        list: { getSnapshot: () => ({ projectionsBySession: projections }), subscribe: (callback: () => void) => { refresh = callback; return () => {} } },
        refreshProjections: vi.fn(),
      },
      slots: {
        entries: () => [], subscribe: () => () => {},
        inject: (_name: string, register: () => unknown) => register(),
        register: (options: Registration) => { registered.add(options); return () => { registered.delete(options) } },
      },
    }
    apply(ctx as never)
    const observer = [...registered].find(entry => entry.id === 'sidechain-native-observer')!
    const actions = observer.inject!('parent')
    actions.openChild!(CHILD_ID)
    expect(openResource).toHaveBeenCalledWith(expect.stringContaining(CHILD_ID), { kind: 'subagentchat' })
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

describe('command menu presentation', () => {
  it('localizes only Sidechain command rows without changing routing or the original snapshot', () => {
    const state: MenuState = {
      open: true, hit: null, generation: 7, highlight: { source: 'command', index: 1 },
      groups: [
        { source: 'command', status: 'ready', items: [
          { name: 'compact', label: '压缩', section: '指令' },
          { name: 'side', description: 'host side description', hint: '<question>', section: '指令' },
          { name: 'btw', description: 'host btw description', hint: '<question>', section: '指令' },
        ] },
        { source: 'skill', status: 'ready', items: [{ name: 'side', label: 'Unrelated skill' }] },
      ],
    }
    const before = structuredClone(state)
    for (const dictionary of [zh, en]) {
      const localized = localizeCommandMenu(state, key => dictionary[key])
      expect(localized.highlight).toBe(state.highlight)
      expect(localized.generation).toBe(state.generation)
      expect(localized.groups[1]).toBe(state.groups[1])
      expect(localized.groups[0]!.items[0]).toBe(state.groups[0]!.items[0])
      expect(localized.groups[0]!.items.map(item => item.name)).toEqual(['compact', 'side', 'btw'])
      for (const [index, name] of [[1, 'side'], [2, 'btw']] as const) {
        expect(localized.groups[0]!.items[index]).toEqual({
          ...state.groups[0]!.items[index],
          label: dictionary[`command.${name}.label`],
          description: dictionary[`command.${name}.description`],
          icon: expect.any(Function),
        })
      }
    }
    expect(state).toEqual(before)
    const closed = { ...state, open: false }
    expect(localizeCommandMenu(closed, key => zh[key])).toBe(closed)
  })

  it('follows native menu registration and restores it after plugin unload', async () => {
    const slots = new SlotCore()
    slots.register({ name: 'root', children: {
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
    } }, ({ renderSlot }: PropsRenderSlots<'conversation.input.overlay'>) => renderSlot('conversation.input.overlay', {}))
    const ctx = {
      locale: { bind: () => (key: keyof typeof zh) => zh[key] },
      slots: {
        entries: slots.entries.bind(slots), subscribe: slots.subscribe.bind(slots), register: slots.register.bind(slots),
        inject: (_name: string, callback: () => () => void) => callback(),
      },
    }
    const dispose = installCommandMenu(ctx as never)
    expect(slots.entriesOfSlot('conversation.input.overlay')).toHaveLength(0)
    const native = () => null
    const removeNative = slots.register({ name: 'conversation.input.overlay', id: 'slash-menu', locale: 'slash.menu', inject: () => ({}) }, native)
    await Promise.resolve()
    expect(slots.entriesOfSlot('conversation.input.overlay')[0]!.component).not.toBe(native)
    expect(slots.entries('conversation.input.overlay')).toHaveLength(2)
    removeNative()
    await Promise.resolve()
    expect(slots.entriesOfSlot('conversation.input.overlay')).toHaveLength(0)
    slots.register({ name: 'conversation.input.overlay', id: 'slash-menu', locale: 'slash.menu', inject: () => ({}) }, native)
    await Promise.resolve()
    expect(slots.entriesOfSlot('conversation.input.overlay')[0]!.component).not.toBe(native)
    dispose()
    await Promise.resolve()
    expect(slots.entriesOfSlot('conversation.input.overlay')[0]!.component).toBe(native)
    expect(slots.entries('conversation.input.overlay')).toHaveLength(1)
  })
})
