// VM-5 — Alignment Score v1 formula tests. The formula is pinned: these
// tests are the spec. A failing test after an alignment.ts edit means the
// edit needed a new version, not a green build.

import { describe, expect, it } from 'vitest'
import {
  ALIGNMENT_VERSION,
  alignmentFromValueBuckets,
  computeAlignment,
  type EligibleTxn,
} from '../alignment'
import { aggregateMonthSpending } from '@/lib/analytics/monthly-snapshot'

const txn = (over: Partial<EligibleTxn>): EligibleTxn => ({
  amount: -10,
  category_id: 'groceries',
  value_category: null,
  value_confidence: null,
  value_confirmed_by_user: null,
  ...over,
})

const confirmed = (vc: string, amount: number): EligibleTxn =>
  txn({ amount, value_category: vc, value_confirmed_by_user: true })

describe('alignmentFromValueBuckets — v1 formula', () => {
  it('computes the ratio over foundation + investment + leak only', () => {
    const r = alignmentFromValueBuckets({
      foundation: 300,
      investment: 100,
      leak: 100,
      burden: 500,
    })
    // (300+100) / (300+100+100) = 0.8 → 80%
    expect(r.alignedSpendPct).toBe(80)
  })

  it('excludes burden from the ratio but counts it in confidence and components', () => {
    const withBurden = alignmentFromValueBuckets({
      foundation: 200,
      leak: 200,
      burden: 600,
      unmapped: 400,
    })
    const withoutBurden = alignmentFromValueBuckets({
      foundation: 200,
      leak: 200,
      unmapped: 400,
    })
    // Ratio identical with or without burden…
    expect(withBurden.alignedSpendPct).toBe(50)
    expect(withoutBurden.alignedSpendPct).toBe(50)
    // …confidence is not: burden is displayable spend.
    expect(withBurden.alignmentConfidence).toBe(round4(1000 / 1400))
    expect(withoutBurden.alignmentConfidence).toBe(round4(400 / 800))
    expect(withBurden.components.burden).toBe(600)
  })

  it('returns null pct when the ratio denominator is 0 — never a fake number', () => {
    const r = alignmentFromValueBuckets({ burden: 500, unmapped: 300 })
    expect(r.alignedSpendPct).toBeNull()
    // Confidence still real: 500 of 800 is displayable.
    expect(r.alignmentConfidence).toBe(0.625)
  })

  it('returns null pct and 0 confidence for empty / null buckets', () => {
    for (const buckets of [{}, null, undefined]) {
      const r = alignmentFromValueBuckets(buckets)
      expect(r.alignedSpendPct).toBeNull()
      expect(r.alignmentConfidence).toBe(0)
      expect(r.components.eligible).toBe(0)
    }
  })

  it('treats legacy non-displayable keys (unsure, no_idea) as eligible but not displayable', () => {
    const r = alignmentFromValueBuckets({
      foundation: 600,
      unsure: 200,
      no_idea: 100,
      unmapped: 100,
    })
    expect(r.alignedSpendPct).toBe(100)
    expect(r.alignmentConfidence).toBe(0.6)
    expect(r.components.displayable).toBe(600)
    expect(r.components.eligible).toBe(1000)
  })

  it('clamps refund-heavy negative buckets to 0 instead of letting them subtract', () => {
    const r = alignmentFromValueBuckets({
      foundation: 400,
      investment: -150, // net refund month
      leak: 100,
      unmapped: -50,
    })
    expect(r.components.aligned).toBe(400)
    expect(r.alignedSpendPct).toBe(80) // 400 / 500
    expect(r.alignmentConfidence).toBe(1) // eligible == displayable == 500
  })

  it('stamps the pinned version', () => {
    expect(ALIGNMENT_VERSION).toBe('v1')
    expect(alignmentFromValueBuckets({ foundation: 1 }).version).toBe('v1')
  })

  it('rounds pct and confidence to 4 decimal places', () => {
    const r = alignmentFromValueBuckets({ foundation: 1, leak: 2, unmapped: 4 })
    expect(r.alignedSpendPct).toBe(33.3333) // 1/3 of 100
    expect(r.alignmentConfidence).toBe(0.4286) // 3/7
  })
})

describe('computeAlignment — eligibility mirrors the snapshot writer', () => {
  it('excludes income, neutral categories, and stray positive null-category inflows', () => {
    const r = computeAlignment([
      confirmed('foundation', -100),
      txn({ amount: 2000, category_id: 'income' }), // income out
      txn({ amount: -500, category_id: 'transfers' }), // neutral out
      txn({ amount: -200, category_id: 'savings_investments' }), // neutral out
      txn({ amount: 1500, category_id: null }), // stray inflow out
    ])
    expect(r.components.eligible).toBe(100)
    expect(r.alignmentConfidence).toBe(1)
    expect(r.alignedSpendPct).toBe(100)
  })

  it('applies the VM-1 displayability gate per row', () => {
    const r = computeAlignment([
      // Confirmed always displayable.
      confirmed('leak', -50),
      // Unconfirmed at the 0.6 threshold: displayable.
      txn({ amount: -50, value_category: 'investment', value_confidence: 0.6 }),
      // Unconfirmed below threshold: unmapped.
      txn({ amount: -100, value_category: 'foundation', value_confidence: 0.59 }),
      // 'unsure' never displays regardless of confidence.
      txn({ amount: -100, value_category: 'unsure', value_confidence: 0.9, value_confirmed_by_user: true }),
    ])
    expect(r.components.displayable).toBe(100)
    expect(r.components.eligible).toBe(300)
    expect(r.alignmentConfidence).toBe(round4(100 / 300))
    expect(r.alignedSpendPct).toBe(50) // investment 50 / (investment 50 + leak 50)
  })

  it('nets refunds against their bucket (outflow positive, refund negative)', () => {
    const r = computeAlignment([
      confirmed('foundation', -100),
      confirmed('foundation', 30), // refund nets to 70
      confirmed('leak', -30),
    ])
    expect(r.components.aligned).toBe(70)
    expect(r.alignedSpendPct).toBe(70) // 70 / (70 + 30)
  })

  it('returns the empty result for no transactions', () => {
    const r = computeAlignment([])
    expect(r.alignedSpendPct).toBeNull()
    expect(r.alignmentConfidence).toBe(0)
  })

  it('is exactly equivalent to alignmentFromValueBuckets over aggregateMonthSpending output', () => {
    // The drift pin: the snapshot writer derives the score from its bucket
    // record; this guarantees computeAlignment(txns) can never disagree.
    const txns = [
      confirmed('foundation', -812.4),
      confirmed('investment', -120),
      confirmed('leak', -64.99),
      txn({ amount: -45.5, value_category: 'burden', value_confidence: 0.7 }),
      txn({ amount: -230, value_category: 'investment', value_confidence: 0.3 }),
      txn({ amount: -19.99, value_category: null }),
      txn({ amount: 12.5, value_category: 'foundation', value_confirmed_by_user: true }),
      txn({ amount: 3000, category_id: 'income' }),
      txn({ amount: -400, category_id: 'debt_repayments' }),
      txn({ amount: 250, category_id: null }),
    ]
    const viaTxns = computeAlignment(txns)
    const viaBuckets = alignmentFromValueBuckets(
      aggregateMonthSpending(txns.map((t) => ({ ...t, description: '' })))
        .spendingByValueCategory,
    )
    expect(viaTxns).toEqual(viaBuckets)
  })
})

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
