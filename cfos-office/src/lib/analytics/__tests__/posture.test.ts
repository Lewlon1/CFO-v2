import { describe, it, expect } from 'vitest'
import { detectPosture } from '../posture'
import type { CashFlowAggregates } from '../cashflow-aggregates'

const MAYA_AGG: CashFlowAggregates = {
  t3m_income_monthly: 2223,
  t3m_spend_monthly: 1897,
  runway_days: 23,
  balance_trajectory: 'growing',
  months_observed: 3,
}

const CARLOS_AGG: CashFlowAggregates = {
  t3m_income_monthly: 12100,
  t3m_spend_monthly: 7888,
  runway_days: 171,
  balance_trajectory: 'growing_slowly',
  months_observed: 3,
}

describe('detectPosture', () => {
  it('classifies Maya as surviving', () => {
    const r = detectPosture('variable', MAYA_AGG)
    expect(r.posture).toBe('surviving')
    expect(r.confidence).toBeGreaterThanOrEqual(0.85)
  })

  it('classifies Carlos as planning', () => {
    const r = detectPosture('variable', CARLOS_AGG)
    expect(r.posture).toBe('planning')
    expect(r.confidence).toBeGreaterThanOrEqual(0.85)
  })

  it('classifies a buffered but income-negative user as stable, not planning', () => {
    const r = detectPosture('variable', {
      t3m_income_monthly: 3000,
      t3m_spend_monthly: 4500,
      runway_days: 120,
      balance_trajectory: 'shrinking',
      months_observed: 3,
    })
    expect(r.posture).toBe('stable')
  })

  it('returns unknown when shape is unknown', () => {
    const r = detectPosture('unknown', CARLOS_AGG)
    expect(r.posture).toBe('unknown')
    expect(r.confidence).toBe(0)
  })

  it('returns unknown when runway is null', () => {
    const r = detectPosture('variable', { ...MAYA_AGG, runway_days: null })
    expect(r.posture).toBe('unknown')
    expect(r.confidence).toBe(0)
  })

  it('drops confidence near a boundary', () => {
    // 32d → stable, but within 10% of the 30d surviving boundary
    const r = detectPosture('variable', { ...MAYA_AGG, runway_days: 32 })
    expect(r.posture).toBe('stable')
    expect(r.confidence).toBeLessThan(0.85)
  })

  it('drops confidence with only 2 months observed', () => {
    const r = detectPosture('variable', { ...CARLOS_AGG, months_observed: 2 })
    expect(r.confidence).toBeLessThan(0.85)
  })
})
