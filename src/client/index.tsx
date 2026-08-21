/**
 * dsh-sidechain, browser half: registers compact `/side` and `/btw` command
 * cards into the keyed `conversation.chat.commandview` slot, plus a
 * sidechain right panel listing the current session's side subagents with an
 * embedded conversation view. The panel host lives beside the composer so it
 * also observes blank sessions; the header contributes only its manual
 * toggle. A successful live command reveals the new child without switching
 * or engaging the main conversation.
 */

import type { ClientContext, IWorkspaces, SessionId, SubagentAddress } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SideCommandCard } from './SideCommandCard.tsx'
import { SidechainPanel, SidechainPanelToggle, type SidechainPanelInjected } from './SidechainPanel.tsx'
import { installSidechainStyle } from './panel-style.ts'
import { fetchActivity, fetchTranscript, sendPrompt } from './sidechain-view.ts'
import { NS, en, zh } from './locales.ts'

export const name = 'dsh-sidechain'

export const inject = ['slots', 'sessions', 'locale', 'connection', 'workspaces']

export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions
  const connection = ctx.get('connection') as ConnectionHandle
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const subagents = connection.api.subagents
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sidechain: sidechain dictionaries')
  // One shared keyframe stylesheet (shimmer sweep); the effect's disposer
  // removes it with the fiber — hot unload leaves no stray <style> tags.
  ctx.effect(installSidechainStyle, 'dsh-sidechain: panel stylesheet')
  // Wait for the chat view's declaration instead of registering into an
  // undeclared slot: entry application order is loader-driven, and a direct
  // register racing the declaration fails boot with "slot ... is not declared".
  const readChildTranscript = (address: SubagentAddress) => fetchTranscript(connection.api.sessions, address)
  ctx.slots.inject(
    'conversation.chat.commandview',
    () => ctx.slots.register({
      name: 'conversation.chat.commandview',
      key: 'side',
    }, (props) => <SideCommandCard node={props.node} sessionId={props.sessionId} useSessions={props.useSessions} readChildTranscript={readChildTranscript} />),
  )
  ctx.slots.inject(
    'conversation.chat.commandview',
    () => ctx.slots.register({
      name: 'conversation.chat.commandview',
      key: 'btw',
    }, (props) => <SideCommandCard node={props.node} sessionId={props.sessionId} useSessions={props.useSessions} readChildTranscript={readChildTranscript} />),
  )
  const panelInject = (_parentSessionId: SessionId): SidechainPanelInjected => ({
    readTranscript(address: SubagentAddress) {
      return fetchTranscript(connection.api.sessions, address)
    },
    readActivity(address: SubagentAddress) {
      return fetchActivity(connection.api.sessions, address)
    },
    sendPrompt(address: Extract<SubagentAddress, { mode: 'continuable' }>, text: string) {
      return sendPrompt(subagents, address, text)
    },
    refresh(parentSessionId: SessionId): void {
      void sessions.refreshSubagents(parentSessionId)
    },
    setCatalogOpen(parentSessionId: SessionId, open: boolean): void {
      sessions.setSubagentCatalogOpen(parentSessionId, open)
    },
    openPath(path: string): void {
      // Mirror the main chat's openFile: host open failures stay silent.
      void workspaces.openPath(path).catch(() => {})
    },
  })
  ctx.slots.inject(
    'conversation.input.dock',
    () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'sidechain-panel-host',
      order: 30,
      locale: NS,
      inject: panelInject,
    }, SidechainPanel),
  )
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'sidechain-panel-toggle',
      order: 20,
      locale: NS,
    }, SidechainPanelToggle),
  )
}
