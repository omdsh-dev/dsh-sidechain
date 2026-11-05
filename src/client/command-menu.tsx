import { useMemo, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MenuState, MenuViewInjected, MenuViewProps } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { IconBranchOutlineRegular, IconQuestionOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StoredEntry, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS, type SidechainKey } from './locales.ts'

type NativeMenuEntry = StoredEntry & {
  component: ComponentType<MenuViewProps>
  inject: (sessionId: SessionId | undefined) => MenuViewInjected
}

export function localizeCommandMenu(state: MenuState, t: Translate<SidechainKey>): MenuState {
  if (!state.open) return state
  return {
    ...state,
    groups: state.groups.map(group => group.source !== 'command' ? group : {
      ...group,
      items: group.items.map(item => item.name !== 'side' && item.name !== 'btw' ? item : {
        ...item,
        label: t(`command.${item.name}.label`),
        description: t(`command.${item.name}.description`),
        icon: item.name === 'side' ? IconBranchOutlineRegular : IconQuestionOutlineRegular,
      }),
    }),
  }
}

export function installCommandMenu(ctx: Context): () => void {
  const t = ctx.locale.bind(NS)
  return ctx.slots.inject('conversation.input.overlay', () => {
    let native: NativeMenuEntry | undefined
    let wrapper: ComponentType<MenuViewProps> | undefined
    let dispose: (() => void) | undefined
    const sync = () => {
      const next = ctx.slots.entries('conversation.input.overlay')
        .find(entry => entry.options.id === 'slash-menu' && entry.component !== wrapper) as NativeMenuEntry | undefined
      if (next === native) return
      native = next
      dispose?.()
      dispose = undefined
      if (native === undefined) return
      const NativeMenu = native.component
      wrapper = function SidechainCommandMenu(props: MenuViewProps): JSX.Element {
        const snapshot = useSyncExternalStore(
          listener => props.menu.subscribe(listener), () => props.menu.getSnapshot(), () => props.menu.getSnapshot(),
        )
        const locale = useSyncExternalStore(
          listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot(),
        )
        const localized = useMemo(() => localizeCommandMenu(snapshot, t), [snapshot, locale])
        const menu = useMemo(() => ({ ...props.menu, getSnapshot: () => localized }), [props.menu, localized])
        return <NativeMenu {...props} menu={menu} />
      }
      dispose = ctx.slots.register({
        ...native.options,
        name: 'conversation.input.overlay',
        id: 'slash-menu',
        priority: (native.options.priority ?? 0) - 1,
        locale: 'slash.menu',
        inject: native.inject,
      }, wrapper)
    }
    sync()
    const unsubscribe = ctx.slots.subscribe('conversation.input.overlay', sync)
    return () => { unsubscribe(); dispose?.() }
  })
}
