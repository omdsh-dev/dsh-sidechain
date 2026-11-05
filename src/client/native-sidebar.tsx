import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode, CommandNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidechainModes } from '../sidechain-projection.ts'
import { observeCreatedChildren, type ObservedSideCommands } from './SideCommandCard.tsx'
import { NS } from './locales.ts'

export function nativeChildAddress(parentId: SessionId, childId: SessionId): string {
  const query = new URLSearchParams({ parent: parentId, mode: 'continuable' })
  return `dsh-resource://subagentchat/session/${encodeURIComponent(childId)}?${query}`
}

export function sidechainComposerReason(modes: SidechainModes | undefined, childId: string): 'loading' | 'btw' | null {
  return modes === undefined ? 'loading' : modes[childId] === 'btw' ? 'btw' : null
}

export interface NativeChildActions {
  openChild(childId: SessionId): void
}

export function NativeChildObserver({ sessionId, useChat, openChild }:
  PropsRuntime<'conversation.input.dock'> & NativeChildActions): null {
  const nodes = useChat(snapshot => snapshot.nodes.values())
  const commands = useMemo(() => (nodes as readonly ChatNode[])
    .filter((node): node is ChatNode<'command'> => node.kind === 'command')
    .map((node): CommandNode => node.data), [nodes])
  const observed = useRef<{ sessionId: SessionId; startedAt: number; known: ObservedSideCommands | undefined }>({
    sessionId, startedAt: Date.now(), known: undefined,
  })
  useEffect(() => {
    if (observed.current.sessionId !== sessionId) {
      observed.current = { sessionId, startedAt: Date.now(), known: undefined }
    }
    const next = observeCreatedChildren(observed.current.known, commands, observed.current.startedAt)
    observed.current.known = next.known
    for (const childId of next.children) openChild(childId)
  }, [commands, sessionId, openChild])
  return null
}

export interface ReadOnlyActions {
  refresh(parentId: SessionId): Promise<void>
  stop(): Promise<boolean>
}
export interface ReadOnlyMatch {
  parentId: SessionId
  reason: 'loading' | 'btw'
}

export function SidechainReadOnly({ matched, useSession, useSessions, refresh, stop, t }: PropsRuntime<'conversation.composer'>
  & PropsLocale<typeof NS> & ReadOnlyActions
  & { matched: ReadOnlyMatch }): JSX.Element {
  const running = useSession(session => session?.running === true)
  const unavailable = useSessions(state => {
    const projection = state.projectionsBySession[matched.parentId]
    return projection?.state === 'error' || projection?.state === 'migration-required'
      || (projection?.state === 'ready' && projection.values.sidechainModes === undefined)
  })
  const [failed, setFailed] = useState(false)
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    if (matched.reason !== 'loading') return
    let active = true
    void refresh(matched.parentId).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [matched.parentId, matched.reason, refresh])
  return (
    <div role="status" data-sidechain-readonly={matched.reason} style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
      <span>{t(failed || unavailable ? 'view.error' : matched.reason === 'btw' ? 'view.readonly' : 'view.loading')}</span>
      {matched.reason === 'loading' && <Button size="sm" onClick={() => {
        setFailed(false)
        void refresh(matched.parentId).catch(() => setFailed(true))
      }}>{t('view.retry')}</Button>}
      {running && <Button size="sm" disabled={stopping} onClick={() => {
        setStopping(true)
        void stop().then(ok => setFailed(!ok), () => setFailed(true)).finally(() => setStopping(false))
      }}>{t('view.stop')}</Button>}
    </div>
  )
}
