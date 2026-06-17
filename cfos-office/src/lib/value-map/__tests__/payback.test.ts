import { describe, it, expect } from 'vitest'
import { computePayback, type PaybackTxnRow } from '../payback'

function row(overrides: Partial<PaybackTxnRow> = {}): PaybackTxnRow {
  return {
    description: 'PURE GYM LTD',
    amount: -45,
    date: '2026-05-15',
    value_category: 'investment',
    value_confidence: 0.78,
    value_confirmed_by_user: false,
    ...overrides,
  }
}

describe('computePayback', () => {
  it('counts only displayable transactions of answered merchants', () => {
    // normaliseMerchant strips the legal suffix: 'PURE GYM LTD' → 'pure gym'
    const answered = new Set(['pure gym'])
    const rows: PaybackTxnRow[] = [
      row(), // displayable, answered merchant → counts
      row({ value_confidence: 0.3 }), // below display gate → excluded
      row({ value_confidence: 0.3, value_confirmed_by_user: true }), // confirmed → counts
      row({ description: 'OTHER SHOP' }), // not an answered merchant → excluded
      row({ amount: 45 }), // inflow → excluded
      row({ value_category: 'unsure', value_confirmed_by_user: true }), // not a quadrant → excluded
    ]
    const p = computePayback(rows, answered, 10)
    expect(p.answers).toBe(10)
    expect(p.mappedTransactions).toBe(2)
  })

  it('reconciles monthlyMapped to the cent: total / distinct months', () => {
    const answered = new Set(['pure gym', 'waitrose 442'])
    const rows: PaybackTxnRow[] = [
      row({ amount: -45, date: '2026-03-15' }),
      row({ amount: -45, date: '2026-04-15' }),
      row({ description: 'WAITROSE 442', amount: -100.5, date: '2026-04-20', value_category: 'foundation' }),
    ]
    const p = computePayback(rows, answered, 2)
    // total 190.50 over 2 distinct months → 95.25
    expect(p.monthsSpanned).toBe(2)
    expect(p.monthlyMapped).toBe(95.25)
    expect(p.monthlyByQuadrant.investment).toBe(45)
    expect(p.monthlyByQuadrant.foundation).toBe(50.25)
    expect(p.monthlyByQuadrant.burden).toBe(0)
    expect(p.monthlyByQuadrant.leak).toBe(0)
  })

  it('returns zeros when nothing is mapped', () => {
    const p = computePayback([], new Set(['anything']), 5)
    expect(p.mappedTransactions).toBe(0)
    expect(p.monthlyMapped).toBe(0)
    expect(p.monthsSpanned).toBe(1)
  })
})
