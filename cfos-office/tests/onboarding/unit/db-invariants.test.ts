import { describe, it, expect } from 'vitest'
import {
  assertNoValidatorNoteLeak,
  assertNoCaseDupRecurringNames,
  assertReadArithmeticReconciles,
} from '../runner/db-assertions'

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

describe('assertReadArithmeticReconciles (Session 083 — the computation check)', () => {
  it('flags a Read whose compose-time reconciliation failed, quoting the phrase', () => {
    const out = assertReadArithmeticReconciles({
      reconciliation: {
        valid: false,
        skipped: false,
        violations: [
          {
            kind: 'shortfall',
            value: 578,
            phrase: '£578 short',
            reason: 'claims a shortfall of 578 but the goal is covered — surplusOverRequired is 565',
          },
        ],
      },
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('does not reconcile')
    expect(out[0]).toContain('£578 short')
    expect(out[0]).toContain('surplusOverRequired is 565')
  })

  it('passes a Read that reconciled', () => {
    expect(
      assertReadArithmeticReconciles({ reconciliation: { valid: true, skipped: false, violations: [] } }),
    ).toEqual([])
  })

  it('passes when the check was skipped for want of goal context', () => {
    expect(
      assertReadArithmeticReconciles({ reconciliation: { valid: true, skipped: true, violations: [] } }),
    ).toEqual([])
  })

  it('stays silent on Reads composed before 083 (no reconciliation key)', () => {
    expect(assertReadArithmeticReconciles({ layers_used: ['L1'] })).toEqual([])
  })

  it('stays silent when no first_read conversation exists', () => {
    expect(assertReadArithmeticReconciles(null)).toEqual([])
  })

  it('degrades to a readable message when violations are malformed', () => {
    const out = assertReadArithmeticReconciles({ reconciliation: { valid: false, violations: [{}] } })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('no reason recorded')
  })
})
