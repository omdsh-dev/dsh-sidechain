import { describe, expect, it } from 'vitest'
import { nativeChildAddress, sidechainComposerReason } from '../src/client/native-sidebar'
import { boundaryTextRule } from '../src/client/boundary-text'
import { sidePrompt } from '../src/side'
import { SIDE_BOUNDARY_PROMPT } from '../src/prompts'

describe('native sidebar contracts', () => {
  it('uses the real continuable address for both command modes', () => {
    const address = new URL(nativeChildAddress('parent /?' as never, 'child /?' as never))
    expect(decodeURIComponent(address.pathname.slice('/session/'.length))).toBe('child /?')
    expect(address.searchParams.get('parent')).toBe('parent /?')
    expect(address.searchParams.get('mode')).toBe('continuable')
  })

  it('keeps BTW read-only and blocks unresolved identity without blocking normal children', () => {
    expect(sidechainComposerReason(undefined, 'child')).toBe('loading')
    expect(sidechainComposerReason({ child: 'btw' }, 'child')).toBe('btw')
    expect(sidechainComposerReason({ child: 'side' }, 'child')).toBeNull()
    expect(sidechainComposerReason({}, 'ordinary-child')).toBeNull()
  })

  it('folds only a complete opening envelope and preserves the exact question', () => {
    for (const mode of ['side', 'btw'] as const) {
      const block = sidePrompt('question\nwith another line', mode, [], 'Custom persona.')[0]!
      if (block.type !== 'text') throw new Error('Expected opening text')
      const match = boundaryTextRule.match(block.text, 0, {} as never)!
      expect(match.id).toBe('sidechain-boundary')
      expect(match.data).toEqual({ mode })
      expect(block.text.slice(match.end)).toBe('question\nwith another line')
      expect(boundaryTextRule.match(block.text, 1, {} as never)).toBeUndefined()
    }
    expect(boundaryTextRule.match(SIDE_BOUNDARY_PROMPT + '\n\nordinary question', 0, {} as never)).toBeUndefined()
    expect(boundaryTextRule.match('Quoted: ' + SIDE_BOUNDARY_PROMPT, 0, {} as never)).toBeUndefined()
  })
})
