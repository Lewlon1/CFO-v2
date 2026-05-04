import { describe, expect, it } from 'vitest'
import { highFreqMerchantDetector } from '../high-freq-merchant'
import type { TransactionRow } from '../../types'

function tx(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 'tx-' + Math.random(),
    date: '2026-04-01T10:00:00Z',
    description: 'GENERIC',
    amount: -5,
    category: 'dining',
    value_category: 'leak',
    ...overrides,
  }
}

describe('highFreqMerchantDetector', () => {
  it('fires for a merchant visited >= 8 times', async () => {
    const transactions = Array.from({ length: 12 }, () =>
      tx({ description: 'PRET A MANGER', amount: -4.5 }),
    )
    const result = await highFreqMerchantDetector({
      transactions,
      archetype: null,
      currency: 'GBP',
      country: 'GB',
    })
    expect(result.length).toBe(1)
    expect(result[0].pattern_template_key).toBe('rhythm')
    expect(result[0].payload.merchant_name).toMatch(/Pret/i)
    expect(result[0].payload.count).toBe(12)
    expect(result[0].candidate_score).toBeGreaterThan(0.5)
    expect(result[0].candidate_score).toBeLessThanOrEqual(1)
  })

  it('does not fire below the 8-visit threshold', async () => {
    const transactions = Array.from({ length: 7 }, () =>
      tx({ description: 'NEROS COFFEE LONDON' }),
    )
    const result = await highFreqMerchantDetector({
      transactions,
      archetype: null,
      currency: 'GBP',
      country: 'GB',
    })
    expect(result).toHaveLength(0)
  })

  it('skips income and transfer categories', async () => {
    const transactions = Array.from({ length: 12 }, () =>
      tx({ description: 'EMPLOYER PAYROLL', category: 'income', amount: -2000 }),
    )
    const result = await highFreqMerchantDetector({
      transactions,
      archetype: null,
      currency: 'GBP',
      country: 'GB',
    })
    expect(result).toHaveLength(0)
  })

  it('returns the highest-frequency merchant when multiple qualify', async () => {
    const transactions = [
      ...Array.from({ length: 9 }, () => tx({ description: 'TESCO METRO LONDON' })),
      ...Array.from({ length: 20 }, () => tx({ description: 'PRET A MANGER' })),
    ]
    const result = await highFreqMerchantDetector({
      transactions,
      archetype: null,
      currency: 'GBP',
      country: 'GB',
    })
    expect(result.length).toBe(1)
    expect(result[0].payload.merchant_name).toMatch(/Pret/i)
    expect(result[0].payload.count).toBe(20)
  })
})
