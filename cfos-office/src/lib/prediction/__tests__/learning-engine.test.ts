import { describe, it, expect } from 'vitest'
import { computeFlatRule, computeTimeRules, computeAmountRules } from '../learning-engine'
import type { CorrectionSignal } from '../types'

const signal = (
  value_category: 'foundation' | 'investment' | 'leak' | 'burden',
  overrides: Partial<CorrectionSignal> = {}
): CorrectionSignal => ({
  value_category,
  amount: 10,
  time_context: 'weekday_midday',
  weight_multiplier: 1.0,
  created_at: '2026-01-01T12:00:00Z',
  category_id: 'groceries',
  ...overrides,
})

describe('computeFlatRule', () => {
  it('returns a rule for 1 unanimous signal with confidence 0.45', () => {
    const result = computeFlatRule('tesco', [signal('foundation')])
    expect(result).not.toBeNull()
    expect(result!.value_category).toBe('foundation')
    expect(result!.confidence).toBe(0.45)
    expect(result!.total_signals).toBe(1)
    expect(result!.agreement_ratio).toBe(1.0)
    expect(result!.match_type).toBe('merchant')
    expect(result!.match_value).toBe('tesco')
  })

  it('returns a rule for 3 unanimous signals with confidence ~0.70', () => {
    const signals = [signal('foundation'), signal('foundation'), signal('foundation')]
    const result = computeFlatRule('tesco', signals)
    expect(result!.confidence).toBe(0.70)
    expect(result!.agreement_ratio).toBe(1.0)
  })

  it('returns null when agreement_ratio < 0.55 (context-dependent merchant)', () => {
    const signals = [signal('foundation'), signal('leak'), signal('investment')]
    const result = computeFlatRule('tesco', signals)
    expect(result).toBeNull()
  })

  it('uses weight_multiplier in counting', () => {
    const signals = [
      signal('foundation', { weight_multiplier: 2.0 }),
      signal('leak', { weight_multiplier: 1.0 }),
    ]
    // Weighted: foundation=2, leak=1, total=3, agreement=2/3=0.67
    const result = computeFlatRule('tesco', signals)
    expect(result).not.toBeNull()
    expect(result!.value_category).toBe('foundation')
  })

  it('returns null for empty signals', () => {
    const result = computeFlatRule('tesco', [])
    expect(result).toBeNull()
  })
})

describe('computeTimeRules', () => {
  it('creates merchant_time rule when time group has >= 2 signals with >= 0.70 agreement', () => {
    const signals = [
      signal('leak', { time_context: 'weekday_late' }),
      signal('leak', { time_context: 'weekday_late' }),
      signal('foundation', { time_context: 'weekday_midday' }),
      signal('foundation', { time_context: 'weekday_midday' }),
    ]
    const flatRule = computeFlatRule('tesco', signals)
    const timeRules = computeTimeRules('tesco', signals, flatRule)
    expect(timeRules.length).toBe(2)

    const lateRule = timeRules.find(r => r.time_context === 'weekday_late')
    expect(lateRule).toBeDefined()
    expect(lateRule!.value_category).toBe('leak')
    expect(lateRule!.match_type).toBe('merchant_time')

    const middayRule = timeRules.find(r => r.time_context === 'weekday_midday')
    expect(middayRule).toBeDefined()
    expect(middayRule!.value_category).toBe('foundation')
  })

  it('skips time groups with < 2 signals', () => {
    const signals = [
      signal('leak', { time_context: 'weekday_late' }),
      signal('foundation', { time_context: 'weekday_midday' }),
      signal('foundation', { time_context: 'weekday_midday' }),
    ]
    const timeRules = computeTimeRules('tesco', signals, null)
    expect(timeRules.length).toBe(1)
    expect(timeRules[0].time_context).toBe('weekday_midday')
  })

  it('applies 0.95 confidence discount', () => {
    const signals = [
      signal('leak', { time_context: 'weekend_evening' }),
      signal('leak', { time_context: 'weekend_evening' }),
    ]
    const timeRules = computeTimeRules('tesco', signals, null)
    // baseConfidence(2, 1.0) = 0.60, * 0.95 = 0.57
    expect(timeRules[0].confidence).toBe(0.57)
  })
})

describe('computeAmountRules', () => {
  it('creates amount rules when bands have different dominants', () => {
    const signals = [
      signal('foundation', { amount: 5 }),
      signal('foundation', { amount: 8 }),
      signal('leak', { amount: 50 }),
      signal('leak', { amount: 60 }),
    ]
    const result = computeAmountRules('tesco', signals)
    expect(result.rules.length).toBe(2)
    expect(result.deleteFlatRule).toBe(true)

    const lowRule = result.rules.find(r => r.avg_amount_high !== null && r.avg_amount_high! <= 30)
    expect(lowRule).toBeDefined()
    expect(lowRule!.value_category).toBe('foundation')
    expect(lowRule!.match_type).toBe('merchant_amount')

    const highRule = result.rules.find(r => r.avg_amount_low !== null && r.avg_amount_low! >= 8)
    expect(highRule).toBeDefined()
    expect(highRule!.value_category).toBe('leak')
  })

  it('returns no rules when bands have same dominant', () => {
    const signals = [
      signal('foundation', { amount: 5 }),
      signal('foundation', { amount: 50 }),
    ]
    const result = computeAmountRules('tesco', signals)
    expect(result.rules.length).toBe(0)
    expect(result.deleteFlatRule).toBe(false)
  })

  it('returns no rules when fewer than 4 signals total', () => {
    const signals = [
      signal('foundation', { amount: 5 }),
      signal('leak', { amount: 50 }),
    ]
    const result = computeAmountRules('tesco', signals)
    expect(result.rules.length).toBe(0)
  })

  it('returns no rules when a band has agreement < 0.65', () => {
    const signals = [
      signal('foundation', { amount: 5 }),
      signal('leak', { amount: 8 }),
      signal('leak', { amount: 50 }),
      signal('leak', { amount: 60 }),
    ]
    // Low band: foundation=1, leak=1 → agreement 0.50 < 0.65
    const result = computeAmountRules('tesco', signals)
    expect(result.rules.length).toBe(0)
  })
})
