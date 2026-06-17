import { describe, it, expect } from 'vitest'
import { detectTension, type TensionTxnRow } from '../tension-detector'

// Fixed clock: 2026-06-10 → window = the three full months Mar/Apr/May 2026
// (current partial June excluded). D1 edge months: early 2026-03, recent
// 2026-05.
const TODAY = new Date('2026-06-10T12:00:00Z')

function txn(overrides: Partial<TensionTxnRow> & { date: string; amount: number }): TensionTxnRow {
  return {
    description: 'MERCHANT',
    value_category: null,
    value_confidence: null,
    value_confirmed_by_user: null,
    ...overrides,
  }
}

function confirmed(
  date: string,
  amount: number,
  value_category: string,
  description = 'MERCHANT',
): TensionTxnRow {
  return txn({ date, amount, value_category, description, value_confirmed_by_user: true })
}

describe('detectTension — D1 stated–observed mismatch', () => {
  it('fires when the displayable money leans a different quadrant than the family', () => {
    // Family security (leans Foundation) but €900 of €1100 displayable sits
    // in Leak.
    const rows = [
      confirmed('2026-04-05', -900, 'leak', 'BAR TAB'),
      confirmed('2026-04-08', -200, 'foundation', 'SUPERMARKET'),
    ]
    const result = detectTension('security', 'certain', {
      rows,
      protectedMerchants: [],
      currency: 'EUR',
      today: TODAY,
    })
    expect(result.type).toBe('stated_observed_mismatch')
    expect(result.line).toContain('Foundation')
    expect(result.line).toContain('Leak')
  })

  it('ignores transactions outside the three-full-month window', () => {
    const rows = [
      // Current partial month — must not count.
      confirmed('2026-06-05', -900, 'leak'),
      confirmed('2026-04-08', -200, 'foundation'),
    ]
    const result = detectTension('security', 'certain', {
      rows,
      protectedMerchants: [],
      currency: 'EUR',
      today: TODAY,
    })
    expect(result.type).toBe('none')
  })

  it('ignores non-displayable labels (low confidence, unconfirmed)', () => {
    const rows = [
      txn({ date: '2026-04-05', amount: -900, value_category: 'leak', value_confidence: 0.3 }),
      confirmed('2026-04-08', -200, 'foundation'),
    ]
    const result = detectTension('security', 'certain', {
      rows,
      protectedMerchants: [],
      currency: 'EUR',
      today: TODAY,
    })
    expect(result.type).toBe('none')
  })
})

describe('detectTension — D2 protected-but-shrinking', () => {
  it('fires when a protected merchant declines ≥20% across the window edges', () => {
    // Foundation-dominant (no D1). 'gym' March €100 → May €50 = 50% down.
    const rows = [
      confirmed('2026-03-15', -100, 'foundation', 'GYM'),
      confirmed('2026-05-15', -50, 'foundation', 'GYM'),
      confirmed('2026-04-08', -500, 'foundation', 'SUPERMARKET'),
    ]
    const result = detectTension('security', 'certain', {
      rows,
      protectedMerchants: [{ merchant: 'gym', quadrant: 'foundation' }],
      currency: 'EUR',
      today: TODAY,
    })
    expect(result.type).toBe('protected_but_shrinking')
    expect(result.line).toContain('gym')
    expect(result.line).toContain('50%')
  })

  it('does not fire below the 20% threshold', () => {
    const rows = [
      confirmed('2026-03-15', -100, 'foundation', 'GYM'),
      confirmed('2026-05-15', -90, 'foundation', 'GYM'),
    ]
    const result = detectTension('security', 'certain', {
      rows,
      protectedMerchants: [{ merchant: 'gym', quadrant: 'foundation' }],
      currency: 'EUR',
      today: TODAY,
    })
    expect(result.type).toBe('none')
  })
})

describe('detectTension — priority and no-tension variants', () => {
  it('D1 wins over D2 when both would fire', () => {
    const rows = [
      confirmed('2026-04-05', -900, 'leak', 'BAR TAB'),
      confirmed('2026-03-15', -100, 'foundation', 'GYM'),
      confirmed('2026-05-15', -50, 'foundation', 'GYM'),
    ]
    const result = detectTension('security', 'certain', {
      rows,
      protectedMerchants: [{ merchant: 'gym', quadrant: 'foundation' }],
      currency: 'EUR',
      today: TODAY,
    })
    expect(result.type).toBe('stated_observed_mismatch')
  })

  it('neither fires → register-specific no-tension line, never an invented tension', () => {
    const certain = detectTension('agency', 'certain', {
      rows: [],
      protectedMerchants: [],
      currency: 'EUR',
      today: TODAY,
    })
    const exploring = detectTension('agency', 'exploring', {
      rows: [],
      protectedMerchants: [],
      currency: 'EUR',
      today: TODAY,
    })
    expect(certain.type).toBe('none')
    expect(exploring.type).toBe('none')
    expect(certain.line).not.toBe(exploring.line)
  })
})
