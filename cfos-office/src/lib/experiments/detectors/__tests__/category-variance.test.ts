import { describe, expect, it } from 'vitest'
import { categoryVarianceDetector } from '../category-variance'
import type { TransactionRow } from '../../types'

function tx(value_category: string, amount: number, category: string | null = 'other'): TransactionRow {
  return {
    id: 'tx-' + Math.random(),
    date: '2026-04-01T10:00:00Z',
    description: 'X',
    amount,
    category,
    value_category,
  }
}

describe('categoryVarianceDetector', () => {
  it('fires when foundation+burden >= 75% and chosen <= 10%', async () => {
    const transactions: TransactionRow[] = [
      ...Array.from({ length: 10 }, () => tx('foundation', -100)),
      ...Array.from({ length: 5 }, () => tx('burden', -100)),
      tx('investment', -50),
    ]
    const result = await categoryVarianceDetector({
      transactions,
      archetype: null,
      currency: 'EUR',
      country: 'ES',
    })
    expect(result.length).toBe(1)
    expect(result[0].pattern_template_key).toBe('discipline_eats_joy')
    expect(result[0].payload.locked_share).toBeGreaterThanOrEqual(75)
  })

  it('does not fire when chosen share exceeds the ceiling', async () => {
    const transactions: TransactionRow[] = [
      ...Array.from({ length: 10 }, () => tx('foundation', -100)),
      ...Array.from({ length: 3 }, () => tx('burden', -100)),
      ...Array.from({ length: 3 }, () => tx('investment', -100)),
      ...Array.from({ length: 3 }, () => tx('leak', -100)),
    ]
    const result = await categoryVarianceDetector({
      transactions,
      archetype: null,
      currency: 'EUR',
      country: 'ES',
    })
    expect(result).toHaveLength(0)
  })

  it('does not fire below the 500 currency-unit total spend floor', async () => {
    const transactions: TransactionRow[] = [
      ...Array.from({ length: 4 }, () => tx('foundation', -50)),
      tx('burden', -50),
    ]
    const result = await categoryVarianceDetector({
      transactions,
      archetype: null,
      currency: 'EUR',
      country: 'ES',
    })
    expect(result).toHaveLength(0)
  })

  it('skips income and transfer transactions', async () => {
    const transactions: TransactionRow[] = [
      ...Array.from({ length: 10 }, () => tx('foundation', -200)),
      tx('investment', -2000, 'income'),
      tx('investment', -1000, 'transfer'),
    ]
    const result = await categoryVarianceDetector({
      transactions,
      archetype: null,
      currency: 'EUR',
      country: 'ES',
    })
    expect(result.length).toBe(1)
    expect(result[0].payload.locked_share).toBe(100)
  })
})
