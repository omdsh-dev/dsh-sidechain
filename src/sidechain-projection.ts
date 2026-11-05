import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { sideCommandResult } from './command-result.ts'
import type { SideMode } from './prompts.ts'

export type SidechainModes = Readonly<Record<string, SideMode>>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    sidechainModes: SidechainModes
  }
}

const schema = z.record(z.string(), z.enum(['side', 'btw']))

export const sidechainModesProjection = {
  key: 'sidechainModes',
  stateSchema: schema,
  init: () => ({}),
  apply: (state, event) => {
    if (event.type === 'session/end-seed' && event.data.inherited === true) return {}
    if (event.type !== 'command/done') return state
    const created = sideCommandResult(event.data)
    return created === undefined ? state : { ...state, [created.childId]: created.mode }
  },
  wire: { viewSchema: schema, view: state => state },
  stateVersion: 2,
} satisfies ProjectionDefinition<'sidechainModes', SidechainModes>
