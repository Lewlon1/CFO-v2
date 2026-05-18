import { describe, it, expect } from 'vitest'
import { detectIncomeShape } from '../income-shape'

const INCOME = 'income'  // matches INCOME_CATEGORY_ID

function deposit(amount: number, date = '2026-01-15') {
  return { amount, category_id: INCOME, date }
}

describe('detectIncomeShape', () => {
  it('returns unknown for fewer than 4 deposits', () => {
    const result = detectIncomeShape([deposit(3000), deposit(3000), deposit(3000)])
    expect(result.shape).toBe('unknown')
    expect(result.volatility).toBeNull()
    expect(result.deposit_count).toBe(3)
  })

  it('classifies a flat salaried pattern as salaried', () => {
    const result = detectIncomeShape([
      deposit(3200), deposit(3200), deposit(3200),
      deposit(3200), deposit(3200), deposit(3200),
    ])
    expect(result.shape).toBe('salaried')
    expect(result.volatility!).toBeLessThan(0.05)
  })

  it('classifies bonus-month spikes as salaried_with_bonus', () => {
    // Spain 14-payment with modest summer/Christmas bonus: 10 regular
    // months at base + 2 months with a ~40% top-up. Literal "double pay"
    // (5000 vs 2500) produces CV ≈ 0.32 which crosses the variable
    // threshold — that's the documented edge of the band.
    const result = detectIncomeShape([
      deposit(2500), deposit(2500), deposit(2500), deposit(2500),
      deposit(2500), deposit(2500), deposit(2500), deposit(2500),
      deposit(2500), deposit(2500), deposit(3500), deposit(3500),
    ])
    expect(result.shape).toBe('salaried_with_bonus')
    expect(result.volatility!).toBeGreaterThan(0.05)
    expect(result.volatility!).toBeLessThan(0.20)
  })

  it('classifies Maya-style freelance income as variable', () => {
    const result = detectIncomeShape([
      deposit(1400), deposit(680),  deposit(1650),
      deposit(980),  deposit(760),  deposit(1200),
    ])
    expect(result.shape).toBe('variable')
    expect(result.volatility!).toBeCloseTo(0.31, 1)
    expect(result.deposit_count).toBe(6)
  })

  it('classifies Carlos-style retainer+project income as variable', () => {
    const result = detectIncomeShape([
      deposit(3500), deposit(2200), deposit(6800),
      deposit(3500), deposit(2200),
      deposit(3500), deposit(2200), deposit(9400), deposit(3000),
    ])
    expect(result.shape).toBe('variable')
    expect(result.volatility!).toBeGreaterThan(0.50)
    expect(result.deposit_count).toBe(9)
  })

  it('ignores spending rows and non-income deposits', () => {
    const result = detectIncomeShape([
      deposit(3200),
      { amount: -50, category_id: 'groceries', date: '2026-01-02' },
      deposit(3200),
      { amount: 20, category_id: 'transfers', date: '2026-01-05' },
      deposit(3200),
      deposit(3200),
    ])
    expect(result.deposit_count).toBe(4)
    expect(result.shape).toBe('salaried')
  })

  it('handles string amounts (postgres numeric arrives as string)', () => {
    const result = detectIncomeShape([
      { amount: '3200.00', category_id: INCOME, date: '2026-01-01' },
      { amount: '3200.00', category_id: INCOME, date: '2026-02-01' },
      { amount: '3200.00', category_id: INCOME, date: '2026-03-01' },
      { amount: '3200.00', category_id: INCOME, date: '2026-04-01' },
    ])
    expect(result.shape).toBe('salaried')
  })
})
