import { describe, it, expect } from 'vitest'
import { quickClassifyGoalDeferral } from './goal-deferral-quickcheck'

describe('quickClassifyGoalDeferral', () => {
  it('treats clear visibility-first / no-goal answers as deferred', () => {
    const deferred = [
      'Visibility', // Marcus's exact answer
      'visibility',
      'just visibility for now',
      'I just want visibility first',
      'I just want to see where my money goes',
      'see where my money goes',
      'no specific goal',
      'no goal yet',
      "I don't have a goal",
      "haven't thought of a target",
      "let's skip the goal for now",
      'no need for a goal right now',
      'I want to get some visibility first',
    ]
    for (const text of deferred) {
      expect(quickClassifyGoalDeferral(text)).toBe('deferred')
    }
  })

  it('does not treat concrete goal answers as deferred', () => {
    const ambiguous = [
      'I want to save £5000 by summer',
      'clear the credit card',
      'about £4k on the card',
      'maybe £20,000 for a deposit',
      'in a couple of years',
      'yes that looks right',
    ]
    for (const text of ambiguous) {
      expect(quickClassifyGoalDeferral(text)).toBe('ambiguous')
    }
  })

  it('returns ambiguous for empty input', () => {
    expect(quickClassifyGoalDeferral('')).toBe('ambiguous')
    expect(quickClassifyGoalDeferral('   ')).toBe('ambiguous')
  })
})
