import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserTextNodeProps, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '../sidechain-projection.ts'
import { SIDE_BOUNDARY_PROMPT, SIDE_MODE_LINE } from '../prompts.ts'
import { NS } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    'sidechain-boundary': { readonly mode: 'side' | 'btw' }
  }
}

export const boundaryTextRule: UserTextRule<'sidechain-boundary'> = {
  id: 'sidechain-boundary',
  order: -20,
  match(text, from) {
    if (from !== 0 || !text.startsWith(SIDE_BOUNDARY_PROMPT + '\n\n')) return undefined
    for (const mode of ['side', 'btw'] as const) {
      const marker = '\n\n' + SIDE_MODE_LINE[mode] + '\n\n'
      const index = text.indexOf(marker, SIDE_BOUNDARY_PROMPT.length)
      if (index >= 0) return { id: 'sidechain-boundary', start: 0, end: index + marker.length, data: { mode } }
    }
    return undefined
  },
}

export function SidechainBoundary({ node, raw, sessionId, useSession, useSessions, t }:
  UserTextNodeProps<'sidechain-boundary'> & PropsLocale<typeof NS>): JSX.Element {
  const parentId = useSession(session => session.subagent?.address.parentSessionId)
  const mode = useSessions(state => parentId === undefined ? undefined : state.projectionsBySession[parentId]?.values.sidechainModes?.[sessionId])
  const [expanded, setExpanded] = useState(false)
  if (mode !== node.data.mode) return <span>{raw}</span>
  return <span data-sidechain-boundary="" style={{ display: 'block', marginBottom: 8 }}>
    <Button size="sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('view.instructions')}</Button>
    {expanded && <span style={{ display: 'block', whiteSpace: 'pre-wrap', opacity: 0.7 }}>{raw}</span>}
  </span>
}
