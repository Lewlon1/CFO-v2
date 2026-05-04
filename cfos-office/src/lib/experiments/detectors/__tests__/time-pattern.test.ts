import { describe, expect, it } from 'vitest'
import { timePatternDetector } from '../time-pattern'
import type { TransactionRow } from '../../types'

// Helper: build a transaction on a specific UTC date.
function txOn(date: string, amount: number, value_category: string = 'leak'): TransactionRow {
  return {
    id: 'tx-' + Math.random(),
    date: `${date}T12:00:00Z`,
    description: 'X',
    amount,
    category: 'dining',
    value_category,
  }
}

describe('timePatternDetector', () => {
  it('fires when weekend avg is >= 1.5x weekday avg', async () => {
    // 4 weekend days at £40/day = £160 weekend, avg £40
    // 10 weekday days at £10/day = £100 weekday, avg £10
    // ratio = 4.0 → fires
    const transactions: TransactionRow[] = [
      // April 2026: Sat 4, 11, 18, 25 / Sun 5, 12, 19, 26
      txOn('2026-04-04', -40),
      txOn('2026-04-05', -40),
      txOn('2026-04-11', -40),
      txOn('2026-04-12', -40),
      // 10 weekdays
      txOn('2026-04-06', -10),
      txOn('2026-04-07', -10),
      txOn('2026-04-08', -10),
      txOn('2026-04-09', -10),
      txOn('2026-04-10', -10),
      txOn('2026-04-13', -10),
      txOn('2026-04-14', -10),
      txOn('2026-04-15', -10),
      txOn('2026-04-16', -10),
      txOn('2026-04-17', -10),
    ]
    const result = await timePatternDetector({
      transactions,
      archetype: null,
      currency: 'GBP',
      country: 'GB',
    })
    expect(result.length).toBe(1)
    expect(result[0].pattern_template_key).toBe('weekend_clock')
    expect(parseFloat(result[0].payload.ratio as string)).toBeGreaterThan(1.5)
  })

  it('does not fire when ratio is below 1.5', async () => {
    const transactions: TransactionRow[] = [
      txOn('2026-04-04', -12),
      txOn('2026-04-05', -12),
      txOn('2026-04-11', -12),
      txOn('2026-04-12', -12),
      txOn('2026-04-06', -10),
      txOn('2026-04-07', -10),
      txOn('2026-04-08', -10),
      txOn('2026-04-09', -10),
      txOn('2026-04-10', -10),
      txOn('2026-04-13', -10),
      txOn('2026-04-14', -10),
      txOn('2026-04-15', -10),
      txOn('2026-04-16', -10),
      txOn('2026-04-17', -10),
    ]
    const result = await timePatternDetector({
      transactions,
      archetype: null,
      currency: 'GBP',
      country: 'GB',
    })
    expect(result).toHaveLength(0)
  })

  it('skips foundation transactions (rent / direct debits)', async () => {
    // Big foundation hits on weekdays would otherwise mask the pattern.
    // April 2026: weekends Sat/Sun = {04,05,11,12,18,19,25,26}.
    // Weekday slots covering ≥ 10 distinct weekdays: 06,07,08,09,10,13,14,15,16,17.
    const weekdays = ['06', '07', '08', '09', '10', '13', '14', '15', '16', '17']
    const transactions: TransactionRow[] = [
      txOn('2026-04-04', -50),
      txOn('2026-04-05', -50),
      txOn('2026-04-11', -50),
      txOn('2026-04-12', -50),
      ...weekdays.map((d) => txOn(`2026-04-${d}`, -1500, 'foundation')),
      ...weekdays.map((d) => txOn(`2026-04-${d}`, -10, 'leak')),
    ]
    const result = await timePatternDetector({
      transactions,
      archetype: null,
      currency: 'GBP',
      country: 'GB',
    })
    expect(result.length).toBe(1)
  })

  it('does not fire below the day-coverage floor', async () => {
    // Only 2 weekend days observed.
    const transactions: TransactionRow[] = [
      txOn('2026-04-04', -100),
      txOn('2026-04-05', -100),
      ...Array.from({ length: 10 }, (_, i) => txOn(`2026-04-${(i + 6).toString().padStart(2, '0')}`, -10)),
    ]
    const result = await timePatternDetector({
      transactions,
      archetype: null,
      currency: 'GBP',
      country: 'GB',
    })
    expect(result).toHaveLength(0)
  })
})
