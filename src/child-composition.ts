/**
 * Per-child composition for side conversations.
 *
 * DSH `0.2.1-alpha.2` accepted `persona` and `toolFilter` directly on a
 * subagent start request. The `0.2.1-rc.2` seam removed both from
 * `SubagentStartRequest`: the durable subagent descriptor still carries them,
 * but only to replay children created by older runtimes. The supported
 * equivalent is to compose the child's own scoped world at its creation edge.
 * The activation manager awaits `agent/created` listeners before releasing the
 * child's queued prompt, so a prompt section and a tool restriction registered
 * here are already in place for the child's first request.
 *
 * Composition is keyed by the child ids this plugin reserved before startup and
 * by every id recorded in the sidechain registry, so a child cold-resumed after
 * a restart is composed again rather than silently widening its surface.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

/**
 * The deployment persona prefix slot. A scoped section with this exact name
 * shadows the deployment persona, which is what makes the side-conversation
 * persona a replacement rather than an extra paragraph.
 */
const PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'

/** Centrally allocated sort order of the deployment persona prefix section. */
const PERSONA_PREFIX_ORDER = 0

/** One scoped prompt section as `systemPrompt.section` accepts it. */
interface ScopedPromptSection {
  readonly name: string
  readonly order: number
  readonly text: string
  readonly interpolate?: boolean
}

/**
 * Structural face of the scoped services reachable through `agent.ctx`.
 * Structural rather than imported: composing a child must not make the plugin
 * depend on the system-prompt or tools packages being mounted, and an absent
 * service simply leaves that part of the composition unapplied.
 */
interface ScopedComposition {
  readonly systemPrompt?: { section(section: ScopedPromptSection): () => void }
  readonly tools?: { restrict(filter: ToolRestriction): () => void }
}

/** The per-instance child composition face. */
export interface ChildComposition {
  /** Record the composition for a child id reserved before its start call. */
  expect(childId: SessionId): void
  /** Remove the future-agent listener and forget pending reservations. */
  dispose(): void
}

/** Composition options resolved from plugin config. */
export interface CompositionOptions {
  /** Persona shadowing the deployment persona inside side children. */
  persona?: string
  /** Optional allow-list restriction applied to side children. */
  toolFilter?: ToolRestriction
}

/**
 * Install the creation-edge composition for side children.
 * @param ctx - root plugin context; also used to compose already-live children.
 * @param options - persona and tool restriction from plugin config.
 * @param isSideChild - whether a child id belongs to this plugin's registry.
 * @returns the reservation face and its disposer.
 */
export function createChildComposition(
  ctx: Context,
  options: CompositionOptions,
  isSideChild: (childId: SessionId) => boolean,
): ChildComposition {
  const expected = new Set<SessionId>()
  const applied = new WeakSet<Agent>()

  const apply = (agent: Agent): void => {
    if (applied.has(agent)) return
    const childId = agent.session.id
    if (!expected.has(childId) && !isSideChild(childId)) return
    applied.add(agent)
    const scoped = agent.ctx as unknown as ScopedComposition
    if (options.persona !== undefined && options.persona !== '') {
      try {
        scoped.systemPrompt?.section({
          name: PERSONA_PREFIX_SECTION,
          order: PERSONA_PREFIX_ORDER,
          text: options.persona,
        })
      } catch {
        // A closed creation window or an already-shadowed slot leaves the
        // deployment persona in place; the child still runs with its boundary prompt.
      }
    }
    if (options.toolFilter !== undefined) {
      try {
        scoped.tools?.restrict(options.toolFilter)
      } catch {
        // Unknown or scope-local names reject the whole filter; the child keeps
        // its inherited surface rather than failing to start.
      }
    }
  }

  // Compose live children on hot load, then every child created afterwards.
  for (const agent of ctx.agents.list()) apply(agent)
  const off = ctx.on('agent/created', ({ agent }) => {
    apply(agent)
    return undefined
  })

  return {
    expect(childId: SessionId): void {
      expected.add(childId)
    },
    dispose(): void {
      off()
      expected.clear()
    },
  }
}
