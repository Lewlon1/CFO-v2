import { describe, it, expect } from 'vitest'
import { assertNoValidatorNoteLeak, assertNoCaseDupRecurringNames } from '../runner/db-assertions'

// Flow-agnostic onboarding invariants that lock in two of the recent fixes,
// asserted on the final DB state regardless of how the persona got there.

describe('assertNoValidatorNoteLeak (fix #2 — no QA "System note" leak)', () => {
  it('flags a leaked appended (first-person) System note', () => {
    const out = assertNoValidatorNoteLeak([
      'Clean message.',
      'Body\n\n---\n\n_(System note: I flagged 2 issues in this message. 3 numbers not grounded in tool output.)_',
    ])
    expect(out).toHaveLength(1)
  })

  it('flags a model-echoed (passive) System note', () => {
    const out = assertNoValidatorNoteLeak([
      '...[/OPTIONS]\n\n---\n\n_(System note: 2 issues flagged in this message. 3 numbers not grounded in tool output.)_',
    ])
    expect(out).toHaveLength(1)
  })

  it('passes clean messages', () => {
    expect(
      assertNoValidatorNoteLeak(['All good.', 'Your free cash flow is the number to watch.']),
    ).toEqual([])
  })
})

describe('assertNoCaseDupRecurringNames (fix #3 — no case-variant recurring dupes)', () => {
  it('flags case-variant duplicates', () => {
    const out = assertNoCaseDupRecurringNames(['Supabase', 'supabase', 'Vercel'])
    expect(out).toHaveLength(1)
  })

  it('passes distinct names', () => {
    expect(assertNoCaseDupRecurringNames(['Supabase', 'Vercel', 'Claude.ai'])).toEqual([])
  })

  it('ignores blanks', () => {
    expect(assertNoCaseDupRecurringNames(['', '  ', 'Netflix'])).toEqual([])
  })
})
