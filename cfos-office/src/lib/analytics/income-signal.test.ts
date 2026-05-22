import { describe, it, expect } from 'vitest'
import { computeIncomeSignal, shouldExposeIncomeSignal, type IncomeSignal } from './income-signal'

const tx = (date: string, amount: number) => ({ amount, date })

const THRESHOLD = 0.7
const zeroSignal: IncomeSignal = {
  confidence: 0,
  monthly_estimate: null,
  cadence: 'unknown',
  detected_count: 0,
}
const strongSignal: IncomeSignal = {
  confidence: 0.85,
  monthly_estimate: 3500,
  cadence: 'monthly',
  detected_count: 4,
}

describe('computeIncomeSignal', () => {
  it('fewer than 3 income candidates → confidence 0, cadence unknown', () => {
    const result = computeIncomeSignal([tx('2026-01-25', 3500), tx('2026-02-25', 3500)])
    expect(result.confidence).toBe(0)
    expect(result.cadence).toBe('unknown')
    expect(result.detected_count).toBe(2)
  })

  it('regular monthly salary with very stable amount → confidence ≥ 0.78', () => {
    const result = computeIncomeSignal([
      tx('2026-01-25', 3500),
      tx('2026-02-25', 3500),
      tx('2026-03-25', 3500),
      tx('2026-04-25', 3500),
    ])
    expect(result.cadence).toBe('monthly')
    expect(result.confidence).toBeGreaterThanOrEqual(0.78)
    expect(result.monthly_estimate).toBe(3500)
  })

  it('monthly cadence with wide variance → confidence between 0.5 and 0.78', () => {
    const result = computeIncomeSignal([
      tx('2026-01-25', 3000),
      tx('2026-02-25', 3800),
      tx('2026-03-25', 4200),
      tx('2026-04-25', 5000),
    ])
    expect(result.cadence).toBe('monthly')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(result.confidence).toBeLessThan(0.78)
  })

  it('irregular cadence → confidence below 0.5', () => {
    const result = computeIncomeSignal([
      tx('2026-01-05', 2000),
      tx('2026-01-22', 1200),
      tx('2026-03-11', 4000),
      tx('2026-04-30', 800),
    ])
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('bi-monthly cadence with stable amount → confidence ≥ 0.7', () => {
    const result = computeIncomeSignal([
      tx('2026-01-01', 1700),
      tx('2026-01-15', 1700),
      tx('2026-02-01', 1700),
      tx('2026-02-15', 1700),
      tx('2026-03-01', 1700),
    ])
    expect(result.cadence).toBe('bi_monthly')
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
    expect(result.monthly_estimate).toBe(3400)
  })

  it('amounts under €500 are excluded', () => {
    const result = computeIncomeSignal([
      tx('2026-01-25', 100),
      tx('2026-02-25', 200),
      tx('2026-03-25', 150),
    ])
    expect(result.detected_count).toBe(0)
    expect(result.confidence).toBe(0)
  })

  it('negative amounts excluded (those are expenses)', () => {
    const result = computeIncomeSignal([
      tx('2026-01-25', -3500),
      tx('2026-02-25', -3500),
      tx('2026-03-25', -3500),
    ])
    expect(result.detected_count).toBe(0)
  })
})

describe('shouldExposeIncomeSignal — gate at computeFirstInsight', () => {
  it('strong inferred signal alone → exposes', () => {
    expect(shouldExposeIncomeSignal(strongSignal, null, THRESHOLD)).toBe(true)
  })

  it('weak signal + user-stated net_monthly_income → exposes (Marcus case)', () => {
    expect(
      shouldExposeIncomeSignal(zeroSignal, { net_monthly_income: 3500 }, THRESHOLD),
    ).toBe(true)
  })

  it('weak signal + no stated income → does not expose', () => {
    expect(shouldExposeIncomeSignal(zeroSignal, { net_monthly_income: null }, THRESHOLD)).toBe(false)
    expect(shouldExposeIncomeSignal(zeroSignal, null, THRESHOLD)).toBe(false)
    expect(shouldExposeIncomeSignal(zeroSignal, {}, THRESHOLD)).toBe(false)
  })

  it('threshold boundary — confidence exactly equal to threshold → exposes', () => {
    const boundary: IncomeSignal = { ...strongSignal, confidence: THRESHOLD }
    expect(shouldExposeIncomeSignal(boundary, null, THRESHOLD)).toBe(true)
  })

  it('zero stated income (user typed 0) → still counts as stated', () => {
    // net_monthly_income == 0 is unusual but valid; the user has answered the
    // question, so we know "income is known" even if the number is 0.
    expect(
      shouldExposeIncomeSignal(zeroSignal, { net_monthly_income: 0 }, THRESHOLD),
    ).toBe(true)
  })
})
