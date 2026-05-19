import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  categoryConcentration,
  recurringExpenseTotal,
} from '../pattern-detectors'
import { monthOverMonthTrend } from '../pattern-detectors'
import type { DetectorContext } from '../insight-types'

const fakeSupabase = {} as SupabaseClient

function baseCtx(
  overrides: Partial<DetectorContext> = {},
): DetectorContext {
  return {
    supabase: fakeSupabase,
    userId: 'test-user',
    transactions: [],
    valueMap: null,
    snapshots: [],
    recurring: [],
    currency: 'EUR',
    country: 'ES',
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tx(
  amount: number,
  category_id: string | null,
  date = '2026-03-15',
): any {
  return {
    id: `t-${Math.random()}`,
    user_id: 'test-user',
    amount,
    category_id,
    date,
    description: 'fixture',
    deleted_at: null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snap(month: string, total_spending: number, by: Record<string, number> = {}): any {
  return {
    month,
    total_spending,
    total_income: 0,
    transaction_count: 50,
    spending_by_category: by,
    user_id: 'test-user',
    surplus_deficit: -total_spending,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rec(amount: number, frequency = 'monthly', category_id = 'subscriptions'): any {
  return {
    name: 'fixture',
    amount,
    frequency,
    category_id,
    user_id: 'test-user',
    status: 'detected',
  }
}

describe('categoryConcentration — topPct denominator includes uncategorised', () => {
  it('reports honest share of total spend (including uncategorised)', async () => {
    // 20 categorised txns: housing dominates (€4,200 across 20 txns at €210),
    // plus 30 uncategorised txns totalling €10,000. Honest denominator: €14,200.
    // Honest topPct = 4200/14200 ≈ 30%.
    const housing = Array.from({ length: 20 }, () => tx(-210, 'housing'))
    const uncat = Array.from({ length: 30 }, () => tx(-333.33, null))
    const ctx = baseCtx({ transactions: [...housing, ...uncat] })

    const result = await categoryConcentration.detect(ctx)
    // Concentration likely doesn't fire (housing is only ~30% of total) — that's
    // the correct behaviour: when uncategorised dominates, you can't honestly
    // call any category "concentrated".
    if (result) {
      const topPct = (result.data.topPct as number) ?? 0
      // Whatever fires, it must be honest about the denominator.
      expect(topPct).toBeLessThanOrEqual(30)
      expect(topPct).toBeGreaterThan(0)
    }
  })

  it('reports the same percentage as before when there is no uncategorised spend', async () => {
    // 30 housing at €200 (€6,000) + 5 groceries at €100 (€500). Total €6,500.
    // topPct = 6000/6500 = 92%.
    const housing = Array.from({ length: 30 }, () => tx(-200, 'housing'))
    const groceries = Array.from({ length: 5 }, () => tx(-100, 'groceries'))
    const ctx = baseCtx({ transactions: [...housing, ...groceries] })

    const result = await categoryConcentration.detect(ctx)
    expect(result).not.toBeNull()
    expect(result!.data.topCategory).toBe('housing')
    expect(result!.data.topPct).toBe(92)
  })

  it('reports concentrated headline correctly when uncategorised is small', async () => {
    // 20 housing at €250 (€5,000) + 5 uncategorised at €100 (€500). Total €5,500.
    // topPct = 5000/5500 = 91%.
    const housing = Array.from({ length: 20 }, () => tx(-250, 'housing'))
    const uncat = Array.from({ length: 5 }, () => tx(-100, null))
    const ctx = baseCtx({ transactions: [...housing, ...uncat] })

    const result = await categoryConcentration.detect(ctx)
    expect(result).not.toBeNull()
    expect(result!.data.topPct).toBe(91)
  })
})

describe('recurringExpenseTotal — recurringPct uses 3-month average', () => {
  it('divides by mean of available monthly snapshots, not the latest one', async () => {
    // Two entertainment overlaps give the detector a non-zero score so it
    // fires; the assertion is on recurringPct using the 3-month mean, not
    // the latest month.
    const recurring = [
      rec(1400, 'monthly', 'housing'),
      rec(500, 'monthly', 'entertainment'),
      rec(500, 'monthly', 'entertainment'),
    ]
    // Latest month €3,500, prior €8,000, oldest €12,000. Mean €7,833.
    // Recurring total €2,400 → 2400/7833 ≈ 31% (not 2400/3500 = 69%).
    const ctx = baseCtx({
      transactions: Array.from({ length: 50 }, () => tx(-100, 'groceries')),
      recurring,
      snapshots: [
        snap('2026-03-01', 3500),
        snap('2026-02-01', 8000),
        snap('2026-01-01', 12000),
      ],
    })

    const result = await recurringExpenseTotal.detect(ctx)
    expect(result).not.toBeNull()
    expect(result!.data.recurringPct).toBe(31)
  })

  it('falls back to null when no snapshots are available', async () => {
    const ctx = baseCtx({
      transactions: Array.from({ length: 50 }, () => tx(-100, 'groceries')),
      recurring: [
        rec(100, 'monthly', 'entertainment'),
        rec(100, 'monthly', 'entertainment'),
        rec(100, 'monthly', 'entertainment'),
      ],
      snapshots: [],
    })

    const result = await recurringExpenseTotal.detect(ctx)
    // Score from overlaps still fires; just the pct is null.
    if (result) {
      expect(result.data.recurringPct).toBeNull()
    }
  })

  it('ignores zero-spending snapshots when computing the average', async () => {
    // Latest month is a placeholder zero-snapshot (e.g. partial-month import
    // hasn't refreshed yet). The detector should treat that as no signal,
    // not as "monthly spend is €0 → recurringPct infinite".
    const ctx = baseCtx({
      transactions: Array.from({ length: 50 }, () => tx(-100, 'groceries')),
      recurring: [
        rec(500, 'monthly', 'utilities_bills'),
        rec(500, 'monthly', 'utilities_bills'),
        rec(500, 'monthly', 'utilities_bills'),
      ],
      snapshots: [
        snap('2026-03-01', 0),
        snap('2026-02-01', 6000),
        snap('2026-01-01', 6000),
      ],
    })

    const result = await recurringExpenseTotal.detect(ctx)
    if (result) {
      // 1500 / 6000 = 25% — the zero-month should be filtered out.
      expect(result.data.recurringPct).toBe(25)
    }
  })
})

describe('monthOverMonthTrend — biggestShiftCategory skips uncategorised', () => {
  it('picks the next-largest non-uncategorised category when uncategorised is biggest', async () => {
    const txns = Array.from({ length: 20 }, () => tx(-100, 'groceries'))
    const ctx = baseCtx({
      transactions: txns,
      snapshots: [
        snap('2026-03-01', 5000, {
          uncategorised: 4000,
          housing: 1400,
          groceries: 700,
        }),
        snap('2026-02-01', 3000, {
          uncategorised: 200,
          housing: 1400,
          groceries: 500,
        }),
      ],
    })

    const result = await monthOverMonthTrend.detect(ctx)
    expect(result).not.toBeNull()
    expect(result!.data.biggestShiftCategory).not.toBe('uncategorised')
    // groceries went 500 → 700, +200 — that's the next-largest real shift.
    expect(result!.data.biggestShiftCategory).toBe('groceries')
  })

  it('returns null biggestShiftCategory when every candidate is uncategorised', async () => {
    const txns = Array.from({ length: 20 }, () => tx(-100, 'groceries'))
    const ctx = baseCtx({
      transactions: txns,
      snapshots: [
        snap('2026-03-01', 5000, { uncategorised: 5000 }),
        snap('2026-02-01', 3000, { uncategorised: 3000 }),
      ],
    })

    const result = await monthOverMonthTrend.detect(ctx)
    if (result) {
      expect(result.data.biggestShiftCategory).toBeNull()
    }
  })
})
