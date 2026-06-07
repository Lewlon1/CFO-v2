import { describe, it, expect } from 'vitest'
import { readContent, evaluateHardRules } from '../runner/judge'
import { builderClassic } from '../personas/builder-classic'

describe('readContent', () => {
  it('unwraps the message wrapper object to its content string', () => {
    const wrapper = { conversationType: 'first_read', content: 'Body line.\n\n— C.', messageId: 'abc' }
    expect(readContent(wrapper)).toBe('Body line.\n\n— C.')
  })
  it('passes a plain string through unchanged', () => {
    expect(readContent('plain')).toBe('plain')
  })
})

describe('evaluateHardRules: signoff on unwrapped content', () => {
  it('passes H1_signoff_present for a Read ending in "— C." (no JSON wrapper)', () => {
    const read = 'Housing is £1,100 of your spend.\n\n[CTA:set_goal]Set a goal[/CTA]\n\n— C.'
    const rules = evaluateHardRules(builderClassic, 'insight', read, null)
    const h1 = rules.find((r) => r.ruleId === 'H1_signoff_present')
    expect(h1?.passed).toBe(true)
  })
})
