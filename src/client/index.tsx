import type { Context } from '@deepseek-ai/cordis'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidechainModes } from '../sidechain-projection.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SideCommandCard } from './SideCommandCard.tsx'
import { NativeChildObserver, SidechainReadOnly, nativeChildAddress, sidechainComposerReason, type ReadOnlyActions, type ReadOnlyMatch } from './native-sidebar.tsx'
import { NS, en, zh } from './locales.ts'
import { boundaryTextRule, SidechainBoundary } from './boundary-text.tsx'
import { installCommandMenu } from './command-menu.tsx'

export const name = 'dsh-sidechain'
export const inject = ['slots', 'sessions', 'locale', 'sidebarRight', 'uiConversation']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sidechain: dictionaries')
  installCommandMenu(ctx)
  ctx.uiConversation.userText.register(boundaryTextRule)
  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node', key: 'sidechain-boundary', locale: NS,
  }, SidechainBoundary))
  const childActions = (parentId: SessionId) => ({
    openChild(childId: SessionId) {
      if (ctx.sidebarRight.mounted.getSnapshot() !== parentId) return
      ctx.sidebarRight.openResource(nativeChildAddress(parentId, childId), { kind: 'subagentchat' })
    },
  })
  for (const key of ['side', 'btw'] as const) {
    ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
      name: 'conversation.chat.commandview', key, locale: NS, inject: childActions,
    }, SideCommandCard))
  }
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'sidechain-native-observer', order: 30, inject: childActions,
  }, NativeChildObserver))
  ctx.slots.inject('conversation.composer', () => {
    const refresh = (parentId: SessionId) => ctx.sessions.refreshProjections(parentId)
    let dispose: (() => void) | undefined
    let previous: ReadonlyMap<string, SidechainModes> | undefined
    const sync = () => {
      const projections = ctx.sessions.list.getSnapshot().projectionsBySession
      const modes = new Map(Object.entries(projections).flatMap(([parentId, projection]) =>
        projection.values.sidechainModes === undefined ? [] : [[parentId, projection.values.sidechainModes] as const]))
      if (previous?.size === modes.size && [...modes].every(([parentId, value]) => previous?.get(parentId) === value)) return
      previous = modes
      dispose?.()
      dispose = ctx.slots.register({
        name: 'conversation.composer', priority: -5, locale: NS,
        select(owner: ComposerChainProps): ReadOnlyMatch | null {
          const address = owner.session?.subagent?.address
          if (address === undefined || address.mode !== 'continuable' || owner.pendingInteraction !== undefined) return null
          const reason = sidechainComposerReason(modes.get(address.parentSessionId), address.childSessionId)
          return reason === null ? null : { parentId: address.parentSessionId, reason }
        },
        inject: (sessionId: SessionId): ReadOnlyActions => ({
          refresh,
          async stop() {
            if (sessionId === undefined) return false
            return (await ctx.sessions.binding(sessionId)?.session.cancel())?.ok === true
          },
        }),
      }, SidechainReadOnly)
    }
    sync()
    const unsubscribe = ctx.sessions.list.subscribe(sync)
    return () => { unsubscribe(); dispose?.() }
  })
}
