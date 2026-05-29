import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  coefficientOfVariation,
  monthlyEquivalent,
  qualifiesAsRecurring,
  groupRecurringClusters,
  MIN_OCCURRENCES,
  MIN_MONTHLY_EQUIVALENT,
} from '../recurring-detector'

// Proxy stub: .from(table) returns canned { data } and ignores chain filters.
// groupRecurringClusters only reads the transactions table.
function buildTxnStub(
  txns: Array<{ id: string; date: string; amount: number; description: string; category_id: string | null }>,
): SupabaseClient {
  const client = {
    from() {
      const payload = { data: txns }
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(payload)
            return () => proxy
          },
        },
      )
      return proxy
    },
  } as unknown as SupabaseClient
  return client
}

describe('coefficientOfVariation', () => {
  it('returns 0 for empty or zero-mean inputs', () => {
    expect(coefficientOfVariation([])).toBe(0)
    expect(coefficientOfVariation([0, 0, 0])).toBe(0)
  })

  it('returns near-0 for identical values (stable subscription)', () => {
    // Netflix at €13.99 every month → CV ≈ 0.
    expect(coefficientOfVariation([13.99, 13.99, 13.99, 13.99])).toBeLessThan(0.01)
  })

  it('returns a meaningful CV for variable amounts (coffee/groceries)', () => {
    // Coffee receipts: €5.82, €6.11, €4.76, €6.50 — CV around 0.1-0.15.
    const cv = coefficientOfVariation([5.82, 6.11, 4.76, 6.5])
    expect(cv).toBeGreaterThan(0.05)
    expect(cv).toBeLessThan(0.2)
  })

  it('returns a large CV for wildly varying amounts (shopping)', () => {
    // El Corte Inglés trips: €441, €126, €263, €840 — CV well over 0.5.
    const cv = coefficientOfVariation([441, 126, 263, 840])
    expect(cv).toBeGreaterThan(0.5)
  })
})

describe('monthlyEquivalent', () => {
  it('converts each known frequency to a monthly amount', () => {
    expect(monthlyEquivalent(100, 'monthly')).toBe(100)
    expect(monthlyEquivalent(100, 'weekly')).toBeCloseTo(433, 0)
    expect(monthlyEquivalent(100, 'bi-weekly')).toBeCloseTo(217, 0)
    expect(monthlyEquivalent(100, 'bi-monthly')).toBe(50)
    expect(monthlyEquivalent(120, 'annual')).toBe(10)
    expect(monthlyEquivalent(300, 'quarterly')).toBe(100)
  })

  it('treats irregular as 1x monthly (preserves the absolute amount)', () => {
    expect(monthlyEquivalent(50, 'irregular')).toBe(50)
  })
})

describe('qualifiesAsRecurring — the regularity gate', () => {
  it('accepts a stable monthly subscription (Netflix)', () => {
    expect(
      qualifiesAsRecurring({
        occurrences: 5,
        amounts: [13.99, 13.99, 13.99, 13.99, 13.99],
        gapsDays: [30, 30, 31, 30],
        frequency: 'monthly',
      }),
    ).toBe(true)
  })

  it('accepts a bi-monthly bill (Endesa-style utility)', () => {
    expect(
      qualifiesAsRecurring({
        occurrences: 3,
        amounts: [155, 158, 152],
        gapsDays: [60, 62],
        frequency: 'bi-monthly',
      }),
    ).toBe(true)
  })

  it('rejects 2-occurrence clusters (below the new minimum)', () => {
    expect(
      qualifiesAsRecurring({
        occurrences: 2,
        amounts: [40, 40],
        gapsDays: [60],
        frequency: 'bi-monthly',
      }),
    ).toBe(false)
  })

  it('accepts a habitual coffee-shop pattern with stable amounts (~€6 weekly)', () => {
    // 4 visits in 3 months at €4.76–6.50 each. CV(amounts) ≈ 0.11, CV(gaps)
    // ≈ 0.13, monthly-equivalent ≈ €6 — passes all gates. Whether the bills
    // page should *display* this as a "bill" is a labelling concern, not a
    // detection concern. The detector's job is to spot a recurring pattern;
    // the downstream UI can decide how to frame it.
    expect(
      qualifiesAsRecurring({
        occurrences: 4,
        amounts: [5.82, 6.11, 4.76, 6.5],
        gapsDays: [22, 18, 25],
        frequency: 'monthly',
      }),
    ).toBe(true)
  })

  it('rejects coffee/shopping with wildly varying amounts (true casual spend)', () => {
    // Shopping at varied amounts even with regular cadence — CV(amounts)
    // well above 0.20, so rejected.
    expect(
      qualifiesAsRecurring({
        occurrences: 5,
        amounts: [4, 8, 22, 15, 6],
        gapsDays: [7, 6, 8, 7],
        frequency: 'weekly',
      }),
    ).toBe(false)
  })

  it('rejects irregular cadence even with stable amounts', () => {
    // Same Netflix amount but cadence wildly off — looks like a manual
    // top-up pattern, not a subscription. CV(gaps) blows past 0.35.
    expect(
      qualifiesAsRecurring({
        occurrences: 4,
        amounts: [13.99, 13.99, 13.99, 13.99],
        gapsDays: [10, 50, 90, 5],
        frequency: 'monthly',
      }),
    ).toBe(false)
  })

  it('rejects sub-€5/month spend regardless of regularity', () => {
    // Coffee weekly at €1 each (€4.33/mo equivalent) — below threshold.
    expect(
      qualifiesAsRecurring({
        occurrences: 12,
        amounts: Array.from({ length: 12 }, () => 1),
        gapsDays: Array.from({ length: 11 }, () => 7),
        frequency: 'weekly',
      }),
    ).toBe(false)
  })

  it('accepts a €5+ monthly subscription (Disney+ at €5.99)', () => {
    expect(
      qualifiesAsRecurring({
        occurrences: 3,
        amounts: [5.99, 5.99, 5.99],
        gapsDays: [30, 30],
        frequency: 'monthly',
      }),
    ).toBe(true)
  })

  it('rejects the El Corte Inglés "monthly" false positive from staging', () => {
    // Real staging data: 3-4 trips at wildly different amounts. Detector
    // averaged the gap to ~30 days and called it 'monthly'. Amounts vary so
    // much that CV exceeds the 0.20 gate.
    expect(
      qualifiesAsRecurring({
        occurrences: 4,
        amounts: [441, 126, 263, 840],
        gapsDays: [28, 33, 29],
        frequency: 'monthly',
      }),
    ).toBe(false)
  })

  it('exposes the threshold constants for callers that need them', () => {
    expect(MIN_OCCURRENCES).toBe(3)
    expect(MIN_MONTHLY_EQUIVALENT).toBe(5)
  })
})

describe('groupRecurringClusters — the shared, pre-gate grouping', () => {
  it('groups outflows by normalised merchant and computes per-cluster stats', async () => {
    const supabase = buildTxnStub([
      { id: 'n1', date: '2026-01-15', amount: -13.99, description: 'Netflix', category_id: 'subscriptions' },
      { id: 'n2', date: '2026-02-14', amount: -13.99, description: 'Netflix', category_id: 'subscriptions' },
      { id: 'n3', date: '2026-03-16', amount: -13.99, description: 'Netflix', category_id: 'subscriptions' },
    ])
    const clusters = await groupRecurringClusters(supabase, 'u1')
    const netflix = clusters.find((c) => c.normName === 'netflix')
    expect(netflix).toBeDefined()
    expect(netflix!.occurrences).toBe(3)
    expect(netflix!.months).toBe(3)
    expect(netflix!.frequency).toBe('monthly')
    expect(netflix!.avgAmount).toBeCloseTo(13.99, 2)
    expect(netflix!.amounts).toHaveLength(3)
    expect(netflix!.gapsDays).toHaveLength(2)
    expect(netflix!.latestCategoryId).toBe('subscriptions')
    // signals must be the exact shape qualifiesAsRecurring consumes.
    expect(netflix!.signals).toMatchObject({ occurrences: 3, frequency: 'monthly' })
  })

  it('excludes singletons (a cluster needs at least one gap)', async () => {
    const supabase = buildTxnStub([
      { id: 'a', date: '2026-01-10', amount: -5, description: 'Coffee Lab', category_id: 'eat_drinking_out' },
      { id: 'b1', date: '2026-01-12', amount: -45.5, description: 'TMB', category_id: 'transport' },
      { id: 'b2', date: '2026-02-12', amount: -45.5, description: 'TMB', category_id: 'transport' },
    ])
    const clusters = await groupRecurringClusters(supabase, 'u1')
    expect(clusters.find((c) => c.normName === 'coffee lab')).toBeUndefined()
    expect(clusters.find((c) => c.normName === 'tmb')).toBeDefined()
  })

  it('carries amounts as positive magnitudes regardless of sign', async () => {
    const supabase = buildTxnStub([
      { id: 's1', date: '2026-01-05', amount: -37.2, description: 'Shell', category_id: 'transport' },
      { id: 's2', date: '2026-02-08', amount: -41.8, description: 'Shell', category_id: 'transport' },
    ])
    const clusters = await groupRecurringClusters(supabase, 'u1')
    const shell = clusters.find((c) => c.normName === 'shell')
    expect(shell!.amounts.every((a) => a > 0)).toBe(true)
    expect(shell!.avgAmount).toBeCloseTo(39.5, 2)
  })
})
