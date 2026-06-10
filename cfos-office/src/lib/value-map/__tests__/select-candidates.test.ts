import { describe, it, expect } from 'vitest'
import {
  chooseCandidates,
  CARD_COUNT_MIN,
  CARD_COUNT_MAX,
  MAX_CARDS_PER_CATEGORY,
  RECURRENCE_BOOST,
  type CandidateTxnRow,
} from '../select-candidates'
import { MIN_VIABLE_CANDIDATES, ONBOARDING_CARD_COUNT } from '@/lib/categorisation/value-config'

let idSeq = 0
function txn(overrides: Partial<CandidateTxnRow> = {}): CandidateTxnRow {
  idSeq += 1
  return {
    id: `t-${idSeq}`,
    description: 'TESCO STORES 1234',
    amount: -25,
    date: '2026-05-15',
    is_recurring: false,
    category_id: 'groceries',
    value_confidence: 0.2,
    value_confirmed_by_user: false,
    ...overrides,
  }
}

/** N distinct merchants, one txn each, distinct categories. */
function distinctMerchants(n: number, overrides: Partial<CandidateTxnRow> = {}): CandidateTxnRow[] {
  return Array.from({ length: n }, (_, i) =>
    txn({
      description: `MERCHANT ${String.fromCharCode(65 + i)}`,
      category_id: `cat-${i}`,
      ...overrides,
    }),
  )
}

// ── Dorcas-style fixture (GBP, broad merchant mix) ────────────────────────

function dorcasRows(): CandidateTxnRow[] {
  idSeq = 0 // content-stable ids — the determinism test compares two builds
  return [
    // Big recurring uncertain merchant — should rank first
    txn({ description: 'PURE GYM LTD', amount: -45, is_recurring: true, category_id: 'health', value_confidence: 0.1 }),
    txn({ description: 'PURE GYM LTD', amount: -45, date: '2026-04-15', is_recurring: true, category_id: 'health', value_confidence: 0.1 }),
    // High spend, low confidence
    txn({ description: 'WAITROSE 442', amount: -310, category_id: 'groceries', value_confidence: 0.2 }),
    // High spend but HIGH confidence — uncertainty term should demote it
    txn({ description: 'SHELL PETROL', amount: -300, category_id: 'transport', value_confidence: 0.9 }),
    // Confirmed merchant — excluded outright
    txn({ description: 'NETFLIX.COM', amount: -16, category_id: 'entertainment', value_confirmed_by_user: true }),
    // Modest uncertain merchants to clear the viability gate
    txn({ description: 'PRET A MANGER', amount: -60, category_id: 'eat_drinking_out', value_confidence: 0.3 }),
    txn({ description: 'BOOTS UK', amount: -40, category_id: 'health2', value_confidence: 0 }),
    txn({ description: 'AMAZON MARKETPLACE', amount: -85, category_id: 'shopping', value_confidence: 0.25 }),
    txn({ description: 'TFL TRAVEL', amount: -90, category_id: 'transport2', value_confidence: 0.15 }),
    txn({ description: 'SPOTIFY AB', amount: -12, is_recurring: true, category_id: 'entertainment2', value_confidence: 0.4 }),
  ]
}

describe('chooseCandidates — selection rules', () => {
  it('is deterministic: same inputs → same cards in the same order', () => {
    const a = chooseCandidates(dorcasRows(), new Set())
    const b = chooseCandidates(dorcasRows(), new Set())
    expect(a).toEqual(b)
  })

  it('excludes user-confirmed merchants', () => {
    const sel = chooseCandidates(dorcasRows(), new Set())
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    expect(sel.candidates.map((c) => c.merchantClean)).not.toContain('netflix.com')
  })

  it('excludes merchants in the settled set (strong rules)', () => {
    const base = chooseCandidates(dorcasRows(), new Set())
    expect(base.ok).toBe(true)
    if (!base.ok) return
    const settled = base.candidates[0].merchantClean
    const sel = chooseCandidates(dorcasRows(), new Set([settled]))
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    expect(sel.candidates.map((c) => c.merchantClean)).not.toContain(settled)
  })

  it('one card per merchant_clean', () => {
    const sel = chooseCandidates(dorcasRows(), new Set())
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    const keys = sel.candidates.map((c) => c.merchantClean)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('caps cards per traditional category', () => {
    // 6 distinct merchants all in ONE category + 6 spread out
    const rows = [
      ...Array.from({ length: 6 }, (_, i) =>
        txn({ description: `COFFEE PLACE ${i}`, category_id: 'eat_drinking_out' }),
      ),
      ...distinctMerchants(6),
    ]
    const sel = chooseCandidates(rows, new Set(), 12)
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    const inCategory = sel.candidates.filter((c) => c.categoryId === 'eat_drinking_out')
    expect(inCategory.length).toBeLessThanOrEqual(MAX_CARDS_PER_CATEGORY)
  })

  it('returns below_min_viable when fewer than MIN_VIABLE_CANDIDATES merchants survive', () => {
    const rows = distinctMerchants(MIN_VIABLE_CANDIDATES - 1)
    const sel = chooseCandidates(rows, new Set())
    expect(sel).toEqual({
      ok: false,
      reason: 'below_min_viable',
      viableCount: MIN_VIABLE_CANDIDATES - 1,
    })
  })

  it('returns no_spend for empty input and ignores inflows', () => {
    expect(chooseCandidates([], new Set())).toMatchObject({ ok: false, reason: 'no_spend' })
    const inflows = distinctMerchants(8, { amount: 500 })
    expect(chooseCandidates(inflows, new Set())).toMatchObject({ ok: false, reason: 'no_spend' })
  })

  it('clamps the served count to the 8–12 range', () => {
    const rows = distinctMerchants(20)
    const tooFew = chooseCandidates(rows, new Set(), 3)
    const tooMany = chooseCandidates(rows, new Set(), 50)
    expect(tooFew.ok && tooFew.candidates.length).toBe(CARD_COUNT_MIN)
    expect(tooMany.ok && tooMany.candidates.length).toBe(CARD_COUNT_MAX)
  })

  it('serves all viable candidates when availability is between MIN_VIABLE and the floor', () => {
    const rows = distinctMerchants(7)
    const sel = chooseCandidates(rows, new Set(), ONBOARDING_CARD_COUNT)
    expect(sel.ok && sel.candidates.length).toBe(7)
  })
})

describe('chooseCandidates — scoring', () => {
  it('score = normalisedMonthlySpend × recurrenceBoost × (1 − confidence)', () => {
    const rows = [
      txn({ description: 'ALPHA', amount: -100, category_id: 'c1', value_confidence: 0.5, is_recurring: false }),
      ...distinctMerchants(7),
    ]
    const sel = chooseCandidates(rows, new Set())
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    const alpha = sel.candidates.find((c) => c.merchantClean === 'alpha')!
    // Alpha has the max monthly spend (100 vs 25) → normalised 1.0
    expect(alpha.score).toBeCloseTo(1 * 1 * (1 - 0.5), 10)
  })

  it('boosts recurring merchants and demotes already-confident ones', () => {
    const rows = [
      txn({ description: 'RECURRING SUB', amount: -50, is_recurring: true, category_id: 'c1', value_confidence: 0 }),
      txn({ description: 'ONE OFF SAME SPEND', amount: -50, is_recurring: false, category_id: 'c2', value_confidence: 0 }),
      txn({ description: 'CONFIDENT BIG SPEND', amount: -50, is_recurring: false, category_id: 'c3', value_confidence: 0.8 }),
      ...distinctMerchants(5),
    ]
    const sel = chooseCandidates(rows, new Set())
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    const byKey = new Map(sel.candidates.map((c) => [c.merchantClean, c]))
    const recurring = byKey.get('recurring sub')!
    const oneOff = byKey.get('one off same spend')!
    const confident = byKey.get('confident big spend')!
    expect(recurring.score).toBeCloseTo(oneOff.score * RECURRENCE_BOOST, 10)
    expect(confident.score).toBeLessThan(oneOff.score)
  })

  it('uses distinct data months as the monthly-spend divisor', () => {
    const rows = [
      txn({ description: 'ALPHA', amount: -60, date: '2026-03-10', category_id: 'c1' }),
      txn({ description: 'ALPHA', amount: -60, date: '2026-04-10', category_id: 'c1' }),
      txn({ description: 'ALPHA', amount: -60, date: '2026-05-10', category_id: 'c1' }),
      ...distinctMerchants(7),
    ]
    const sel = chooseCandidates(rows, new Set())
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    const alpha = sel.candidates.find((c) => c.merchantClean === 'alpha')!
    expect(alpha.monthlySpend).toBeCloseTo(180 / 3, 10)
  })

  it('picks the lowest-confidence (then most recent) transaction as exemplar', () => {
    const rows = [
      txn({ id: 'older-low', description: 'ALPHA', date: '2026-03-10', value_confidence: 0.1, category_id: 'c1' }),
      txn({ id: 'newer-low', description: 'ALPHA', date: '2026-05-10', value_confidence: 0.1, category_id: 'c1' }),
      txn({ id: 'newer-high', description: 'ALPHA', date: '2026-05-20', value_confidence: 0.5, category_id: 'c1' }),
      ...distinctMerchants(7),
    ]
    const sel = chooseCandidates(rows, new Set())
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    const alpha = sel.candidates.find((c) => c.merchantClean === 'alpha')!
    expect(alpha.exemplarTxnId).toBe('newer-low')
  })

  it('places seed merchants (hooks promised to the user) first', () => {
    const rows = dorcasRows()
    const sel = chooseCandidates(rows, new Set(), 10, ['SPOTIFY AB'])
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    expect(sel.candidates[0].merchantClean).toBe('spotify ab')
  })

  it('seeds never bypass the exclusion rules', () => {
    const sel = chooseCandidates(dorcasRows(), new Set(), 10, ['NETFLIX.COM'])
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    expect(sel.candidates.map((c) => c.merchantClean)).not.toContain('netflix.com')
  })
})

// ── Carlos-style fixture (ES merchants, EUR amounts) ──────────────────────

describe('chooseCandidates — Carlos (ES) fixture', () => {
  it('returns a viable selection for a Spanish merchant mix', () => {
    const rows = [
      txn({ description: 'MERCADONA VALENCIA', amount: -240, category_id: 'groceries', value_confidence: 0.2 }),
      txn({ description: 'IBERDROLA CLIENTES', amount: -95, is_recurring: true, category_id: 'utilities', value_confidence: 0.1 }),
      txn({ description: 'RENFE VIAJEROS', amount: -64, category_id: 'transport', value_confidence: 0 }),
      txn({ description: 'FARMACIA GARCIA', amount: -22, category_id: 'health', value_confidence: 0.3 }),
      txn({ description: 'CAFETERIA EL SOL', amount: -38, category_id: 'eat_drinking_out', value_confidence: 0.2 }),
      txn({ description: 'DECATHLON ES', amount: -110, category_id: 'shopping', value_confidence: 0.25 }),
      txn({ description: 'VODAFONE ESPANA', amount: -30, is_recurring: true, category_id: 'utilities2', value_confidence: 0.4 }),
    ]
    const sel = chooseCandidates(rows, new Set())
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    expect(sel.candidates.length).toBeGreaterThanOrEqual(MIN_VIABLE_CANDIDATES)
    // Big recurring uncertain utility should beat the small confident phone bill
    const keys = sel.candidates.map((c) => c.merchantClean)
    expect(keys.indexOf('iberdrola clientes')).toBeLessThan(keys.indexOf('vodafone espana'))
  })
})
