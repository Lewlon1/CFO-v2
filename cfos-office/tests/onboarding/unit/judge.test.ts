import { describe, it, expect } from 'vitest'
import { readContent, evaluateHardRules } from '../runner/judge'
import { builderClassic } from '../personas/builder-classic'
import { loadRead, listReads } from '../fixtures'

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

  it('H1_signoff_present passes when judged via the wrapper object (the original bug)', () => {
    const wrapper = {
      conversationType: 'first_read',
      content: 'Housing is £1,100.\n\n[CTA:set_goal]Set a goal[/CTA]\n\n— C.',
      messageId: 'abc',
    }
    const content = readContent(wrapper)
    const rules = evaluateHardRules(builderClassic, 'insight', content, null)
    expect(rules.find((r) => r.ruleId === 'H1_signoff_present')?.passed).toBe(true)
  })
})

describe('fixtures', () => {
  it('loads the captured corpus', () => {
    expect(listReads().length).toBeGreaterThanOrEqual(18) // 25 fixtures: 10 captured + 8 gbp + 7 bad (loose lower bound)
    expect(loadRead('zane-spain.captured')).toMatch(/— C\.\s*$/)
  })
})
