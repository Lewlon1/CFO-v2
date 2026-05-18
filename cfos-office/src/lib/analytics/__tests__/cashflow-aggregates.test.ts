import { describe, it, expect } from 'vitest'
import { computeCashFlowAggregates } from '../cashflow-aggregates'

describe('computeCashFlowAggregates', () => {
  it('returns unknowns when fewer than 2 months of snapshots', () => {
    const result = computeCashFlowAggregates(
      [
        {
          month: '2026-03-01',
          income_total: 1960,
          spend_total: 1951,
          closing_balance: 1459,
        },
      ],
      1459,
    )
    expect(result.t3m_income_monthly).toBeNull()
    expect(result.t3m_spend_monthly).toBeNull()
    expect(result.balance_trajectory).toBe('unknown')
    expect(result.runway_days).toBeNull()
    expect(result.months_observed).toBe(1)
  })

  it('computes Maya-style aggregates correctly (3 months, growing balance)', () => {
    const result = computeCashFlowAggregates(
      [
        { month: '2026-01-01', income_total: 2080, spend_total: 1736, closing_balance: 824 },
        { month: '2026-02-01', income_total: 2630, spend_total: 2003, closing_balance: 1450 },
        { month: '2026-03-01', income_total: 1960, spend_total: 1951, closing_balance: 1459 },
      ],
      1459.49,
    )
    expect(result.t3m_income_monthly).toBeCloseTo(2223.33, 1)
    expect(result.t3m_spend_monthly).toBeCloseTo(1896.67, 1)
    expect(result.runway_days).toBeGreaterThanOrEqual(22)
    expect(result.runway_days).toBeLessThanOrEqual(24)
    expect(result.balance_trajectory).toBe('growing') // 824 → 1459 is +77%
    expect(result.months_observed).toBe(3)
  })

  it('computes Carlos-style aggregates correctly (3 months, growing_slowly)', () => {
    const result = computeCashFlowAggregates(
      [
        { month: '2026-01-01', income_total: 12500, spend_total: 6193, closing_balance: 38707 },
        { month: '2026-02-01', income_total: 5700, spend_total: 4156, closing_balance: 40250 },
        { month: '2026-03-01', income_total: 18100, spend_total: 13315, closing_balance: 45035 },
      ],
      45035.49,
    )
    expect(result.t3m_income_monthly).toBeCloseTo(12100, 0)
    expect(result.t3m_spend_monthly).toBeCloseTo(7888, 0)
    expect(result.runway_days).toBeGreaterThan(150)
    expect(result.balance_trajectory).toBe('growing_slowly') // 38707 → 45035 is +15%
  })

  it('handles null liquid balance gracefully', () => {
    const result = computeCashFlowAggregates(
      [
        { month: '2026-01-01', income_total: 3000, spend_total: 2500, closing_balance: 5000 },
        { month: '2026-02-01', income_total: 3000, spend_total: 2500, closing_balance: 5500 },
      ],
      null,
    )
    expect(result.runway_days).toBeNull()
    expect(result.t3m_income_monthly).toBe(3000)
    expect(result.t3m_spend_monthly).toBe(2500)
  })

  it('returns trajectory=unknown when any closing_balance in window is null', () => {
    const result = computeCashFlowAggregates(
      [
        { month: '2026-01-01', income_total: 3000, spend_total: 2500, closing_balance: null },
        { month: '2026-02-01', income_total: 3000, spend_total: 2500, closing_balance: 5500 },
      ],
      5500,
    )
    expect(result.balance_trajectory).toBe('unknown')
  })

  it('takes only the 3 most recent months when more are given', () => {
    const result = computeCashFlowAggregates(
      [
        { month: '2025-10-01', income_total: 999999, spend_total: 999999, closing_balance: 1 },
        { month: '2025-11-01', income_total: 999999, spend_total: 999999, closing_balance: 1 },
        { month: '2026-01-01', income_total: 1000, spend_total: 500, closing_balance: 500 },
        { month: '2026-02-01', income_total: 1000, spend_total: 500, closing_balance: 1000 },
        { month: '2026-03-01', income_total: 1000, spend_total: 500, closing_balance: 1500 },
      ],
      1500,
    )
    expect(result.t3m_income_monthly).toBe(1000)
    expect(result.t3m_spend_monthly).toBe(500)
    expect(result.months_observed).toBe(3)
  })
})
