/**
 * Stop side-conversation reports and settlement notices before they enter the
 * parent inbox. Continuable children can deliver both `agent-message` and
 * `subagent-settled` messages through `followup`, `steer`, or `inject`; even
 * filtering later at pre-step leaves inbox and empty-turn events in the main
 * Session log.
 *
 * Child identity is persisted under DSH_HOME so resumed parents still reject
 * authored reports and settlement notices from side children created before a
 * restart. Notices from children this plugin did not register pass through, so
 * other orchestration workflows keep receiving their completion accounts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'

type DeliveryMethod = 'followup' | 'steer' | 'inject'
const DELIVERY_METHODS: readonly DeliveryMethod[] = ['followup', 'steer', 'inject']

/** Per-plugin-instance settlement suppression face. */
export interface SettlementSilence {
  /** Reserve a child id before asynchronous child startup can settle. */
  reserveChild(parent: Agent): SessionId
  /** Register and immediately protect the parent of one side child. */
  noteChild(parent: Agent, childId: SessionId): void
  /** Whether a child id belongs to this plugin's persisted side-child registry. */
  isChild(childId: SessionId): boolean
  /** Restore wrapped agents and remove the future-agent listener. */
  dispose(): void
}

/** The persisted child-id registry file (under the DSH home, like settings). */
function registryPath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'sidechain-children.json')
}

function loadChildren(): Set<SessionId> {
  try {
    const path = registryPath()
    if (!existsSync(path)) return new Set()
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is SessionId => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

function saveChildren(children: ReadonlySet<SessionId>): void {
  try {
    const path = registryPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify([...children]), 'utf8')
  } catch {
    // An unwritable home is non-fatal; the in-process guard still works.
  }
}

interface SettlementSource {
  kind?: string | undefined
  senderSessionId?: string | undefined
}

function isSideChildDelivery(message: UserMessage, children: ReadonlySet<SessionId>): boolean {
  const source = message.source as SettlementSource | undefined
  return (source?.kind === 'agent-message' || source?.kind === 'subagent-report' || source?.kind === 'subagent-settled')
    && source.senderSessionId !== undefined
    && children.has(source.senderSessionId as SessionId)
}

/**
 * Install the parent-inbox boundary for side settlement notices.
 * @param ctx - root plugin context, used to protect future/resumed agents.
 */
export function createSettlementSilence(ctx: Context): SettlementSilence {
  const children = loadChildren()
  const patched = new Map<Agent, ReadonlyMap<DeliveryMethod, PropertyDescriptor | undefined>>()

  const protect = (agent: Agent): void => {
    if (patched.has(agent)) return
    const descriptors = new Map<DeliveryMethod, PropertyDescriptor | undefined>()
    for (const method of DELIVERY_METHODS) {
      descriptors.set(method, Object.getOwnPropertyDescriptor(agent, method))
      const original = agent[method]
      Object.defineProperty(agent, method, {
        configurable: true,
        writable: true,
        value(message: UserMessage): void {
          if (!isSideChildDelivery(message, children)) original.call(agent, message)
        },
      })
    }
    patched.set(agent, descriptors)
  }

  // Protect live parents on hot load and future parents after a cold restart.
  for (const agent of ctx.agents.list()) protect(agent)
  const removeCreatedListener = ctx.on('agent/created', ({ agent }) => { protect(agent); return undefined })

  return {
    reserveChild(parent): SessionId {
      protect(parent)
      const childId = SessionId(randomUUID())
      children.add(childId)
      saveChildren(children)
      return childId
    },
    noteChild(parent, childId): void {
      protect(parent)
      children.add(childId)
      saveChildren(children)
    },
    isChild(childId): boolean {
      return children.has(childId)
    },
    dispose(): void {
      removeCreatedListener()
      for (const [agent, descriptors] of patched) {
        for (const method of DELIVERY_METHODS) {
          const descriptor = descriptors.get(method)
          if (descriptor === undefined) delete (agent as unknown as Record<string, unknown>)[method]
          else Object.defineProperty(agent, method, descriptor)
        }
      }
      patched.clear()
    },
  }
}
