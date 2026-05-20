import { describe, it, expect } from 'vitest'
import { quickClassifyDecline } from './value-map-decline-quickcheck'

describe('quickClassifyDecline', () => {
  it('classifies common decline phrases as declined', () => {
    const declines = [
      'no thanks',
      'No thank you',
      'not now',
      'not really',
      'nope',
      'nah',
      'skip',
      'skip it',
      'pass',
      'maybe later',
      'maybe another time',
      'not interested',
      "i'll pass",
      "let's skip",
      "don't want to",
      'rather not',
    ]
    for (const text of declines) {
      expect(quickClassifyDecline(text)).toBe('declined')
    }
  })

  it('classifies common acceptance phrases as accepted', () => {
    const accepts = [
      'yes',
      'yeah',
      'yep',
      'sure',
      'ok',
      'okay',
      'sounds good',
      "let's do it",
      "let's do that",
      'go for it',
      "i'm in",
      'alright',
      'fine',
      'why not',
      'sure thing',
      "let's try it",
    ]
    for (const text of accepts) {
      expect(quickClassifyDecline(text)).toBe('accepted')
    }
  })

  it('returns ambiguous for empty or borderline text', () => {
    expect(quickClassifyDecline('')).toBe('ambiguous')
    expect(quickClassifyDecline('   ')).toBe('ambiguous')
    expect(quickClassifyDecline('tell me more first')).toBe('ambiguous')
    expect(quickClassifyDecline('what is it')).toBe('ambiguous')
    expect(quickClassifyDecline('how long does it take')).toBe('ambiguous')
  })

  it('returns ambiguous when both decline and accept phrases appear', () => {
    expect(quickClassifyDecline("yes but maybe later")).toBe('ambiguous')
    expect(quickClassifyDecline("sure, but not now")).toBe('ambiguous')
  })

  it('matches phrases inside longer sentences', () => {
    expect(quickClassifyDecline('not now, thanks')).toBe('declined')
    expect(quickClassifyDecline("yeah, sounds great")).toBe('accepted')
  })

  it('is case-insensitive', () => {
    expect(quickClassifyDecline('NO THANKS')).toBe('declined')
    expect(quickClassifyDecline('YES')).toBe('accepted')
  })
})
