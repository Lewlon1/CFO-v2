import { describe, it, expect } from 'vitest'
import { generateObservations } from '../observations'
import type { ValueMapResult, ValueMapTransaction, ValueQuadrant } from '../types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ValueMapResult> & { merchant: string; quadrant: ValueQuadrant }): ValueMapResult {
  return {
    transaction_id: `tx-${overrides.merchant.toLowerCase().replace(/\s+/g, '-')}`,
    amount: 30,
    confidence: 3,
    first_tap_ms: 2000,
    card_time_ms: 4000,
    deliberation_ms: 2000,
    ...overrides,
  }
}

function makeTx(id: string, merchant: string, category: string): ValueMapTransaction {
  return {
    id,
    merchant,
    description: null,
    amount: 30,
    currency: 'GBP',
    transaction_date: '2026-03-01',
    is_recurring: false,
    category_name: category,
  }
}

// ── Profile 1: Contradiction-heavy ──────────────────────────────────────────

describe('Rule 1 — Contradiction detection', () => {
  const results: ValueMapResult[] = [
    makeResult({ merchant: 'PureGym', quadrant: 'leak', transaction_id: 'tx-puregym' }),
    makeResult({ merchant: 'Headspace', quadrant: 'investment', transaction_id: 'tx-headspace' }),
    makeResult({ merchant: 'Tesco', quadrant: 'foundation', transaction_id: 'tx-tesco' }),
    makeResult({ merchant: 'Deliveroo', quadrant: 'leak', transaction_id: 'tx-deliveroo' }),
    makeResult({ merchant: 'Netflix', quadrant: 'leak', transaction_id: 'tx-netflix' }),
  ]

  const transactions: ValueMapTransaction[] = [
    makeTx('tx-puregym', 'PureGym', 'Health & Fitness'),
    makeTx('tx-headspace', 'Headspace', 'Health & Fitness'),
    makeTx('tx-tesco', 'Tesco', 'Groceries'),
    makeTx('tx-deliveroo', 'Deliveroo', 'Dining'),
    makeTx('tx-netflix', 'Netflix', 'Subscriptions'),
  ]

  it('detects same-category contradiction', () => {
    const obs = generateObservations(results, transactions)
    const contradiction = obs.find((o) => o.rule === 'contradiction')
    expect(contradiction).toBeDefined()
    expect(contradiction!.merchants).toContain('PureGym')
    expect(contradiction!.merchants).toContain('Headspace')
    expect(contradiction!.text).toContain('Health & Fitness')
  })

  it('returns contradiction as highest priority', () => {
    const obs = generateObservations(results, transactions)
    expect(obs[0].rule).toBe('contradiction')
    expect(obs[0].priority).toBe(1)
  })
})

// ── Profile 2: Hesitant user ────────────────────────────────────────────────

describe('Rule 2 — Hesitation spike', () => {
  const results: ValueMapResult[] = [
    makeResult({ merchant: 'Rent', quadrant: 'burden', first_tap_ms: 12000, transaction_id: 'tx-rent' }),
    makeResult({ merchant: 'Tesco', quadrant: 'foundation', first_tap_ms: 2000, transaction_id: 'tx-tesco' }),
    makeResult({ merchant: 'Netflix', quadrant: 'investment', first_tap_ms: 1800, transaction_id: 'tx-netflix' }),
    makeResult({ merchant: 'Amazon', quadrant: 'leak', first_tap_ms: 2200, transaction_id: 'tx-amazon' }),
    makeResult({ merchant: 'Gym', quadrant: 'investment', first_tap_ms: 1500, transaction_id: 'tx-gym' }),
  ]

  const transactions = results.map((r) =>
    makeTx(r.transaction_id, r.merchant, 'General'),
  )

  it('detects hesitation spike on slow merchant', () => {
    const obs = generateObservations(results, transactions)
    const spike = obs.find((o) => o.rule === 'hesitation_spike')
    expect(spike).toBeDefined()
    expect(spike!.merchants).toContain('Rent')
    expect(spike!.text).toContain('12.0s')
    expect(spike!.text).toContain('the weight of this one is real')
  })
})

// ── Profile 3: Confident outlier ────────────────────────────────────────────

describe('Rule 3 — Confidence outlier', () => {
  const results: ValueMapResult[] = [
    makeResult({ merchant: 'Rent', quadrant: 'foundation', confidence: 5, transaction_id: 'tx-rent' }),
    makeResult({ merchant: 'Netflix', quadrant: 'leak', confidence: 2, transaction_id: 'tx-netflix' }),
    makeResult({ merchant: 'Tesco', quadrant: 'foundation', confidence: 3, transaction_id: 'tx-tesco' }),
    makeResult({ merchant: 'Deliveroo', quadrant: 'leak', confidence: 2, transaction_id: 'tx-deliveroo' }),
    makeResult({ merchant: 'Amazon', quadrant: 'leak', confidence: 3, transaction_id: 'tx-amazon' }),
  ]

  const transactions = results.map((r) =>
    makeTx(r.transaction_id, r.merchant, 'General'),
  )

  it('detects confidence-5 outlier when avg < 4', () => {
    const obs = generateObservations(results, transactions)
    const outlier = obs.find((o) => o.rule === 'confidence_outlier')
    expect(outlier).toBeDefined()
    expect(outlier!.merchants).toContain('Rent')
    expect(outlier!.text).toContain('completely certain')
    expect(outlier!.text).toContain('foundation')
  })
})

// ── Profile 4: Burden/Leak dominant ─────────────────────────────────────────

describe('Rule 4 — Burden + Leak dominance', () => {
  const results: ValueMapResult[] = [
    makeResult({ merchant: 'Rent', quadrant: 'burden', transaction_id: 'tx-rent' }),
    makeResult({ merchant: 'Council Tax', quadrant: 'burden', transaction_id: 'tx-ct' }),
    makeResult({ merchant: 'Netflix', quadrant: 'leak', transaction_id: 'tx-netflix' }),
    makeResult({ merchant: 'Deliveroo', quadrant: 'leak', transaction_id: 'tx-deliveroo' }),
    makeResult({ merchant: 'Zara', quadrant: 'leak', transaction_id: 'tx-zara' }),
    makeResult({ merchant: 'Tesco', quadrant: 'foundation', transaction_id: 'tx-tesco' }),
  ]

  const transactions = results.map((r) =>
    makeTx(r.transaction_id, r.merchant, 'General'),
  )

  it('detects burden+leak > 50%', () => {
    const obs = generateObservations(results, transactions)
    const dom = obs.find((o) => o.rule === 'burden_leak_dominance')
    expect(dom).toBeDefined()
    expect(dom!.text).toContain('weighing you down or slipping away')
  })
})

// ── Profile 5: Foundation-heavy ─────────────────────────────────────────────

describe('Rule 5 — Foundation-heavy', () => {
  const results: ValueMapResult[] = [
    makeResult({ merchant: 'Rent', quadrant: 'foundation', transaction_id: 'tx-rent' }),
    makeResult({ merchant: 'Tesco', quadrant: 'foundation', transaction_id: 'tx-tesco' }),
    makeResult({ merchant: "Sainsbury's", quadrant: 'foundation', transaction_id: 'tx-sainsburys' }),
    makeResult({ merchant: 'Council Tax', quadrant: 'foundation', transaction_id: 'tx-ct' }),
    makeResult({ merchant: 'EE', quadrant: 'foundation', transaction_id: 'tx-ee' }),
    makeResult({ merchant: 'Netflix', quadrant: 'investment', transaction_id: 'tx-netflix' }),
    makeResult({ merchant: 'Gym', quadrant: 'investment', transaction_id: 'tx-gym' }),
    makeResult({ merchant: 'Deliveroo', quadrant: 'leak', transaction_id: 'tx-deliveroo' }),
  ]

  const transactions = results.map((r) =>
    makeTx(r.transaction_id, r.merchant, 'General'),
  )

  it('detects foundation > 45%', () => {
    const obs = generateObservations(results, transactions)
    const fh = obs.find((o) => o.rule === 'foundation_heavy')
    expect(fh).toBeDefined()
    expect(fh!.text).toContain('accepting costs you could reduce')
  })
})

// ── Rule 6 — Speed pattern ──────────────────────────────────────────────────

describe('Rule 6 — Speed pattern', () => {
  // 3 fast foundation + 4 mixed others = foundation 43% (under 45% so Rule 5 won't fire)
  // burden+leak = 2/7 = 29% (under 50% so Rule 4 won't fire)
  const results: ValueMapResult[] = [
    makeResult({ merchant: 'Rent', quadrant: 'foundation', first_tap_ms: 500, transaction_id: 'tx-rent' }),
    makeResult({ merchant: 'Tesco', quadrant: 'foundation', first_tap_ms: 600, transaction_id: 'tx-tesco' }),
    makeResult({ merchant: "Sainsbury's", quadrant: 'foundation', first_tap_ms: 700, transaction_id: 'tx-sainsburys' }),
    makeResult({ merchant: 'Gym', quadrant: 'investment', first_tap_ms: 3000, transaction_id: 'tx-gym' }),
    makeResult({ merchant: 'Udemy', quadrant: 'investment', first_tap_ms: 2800, transaction_id: 'tx-udemy' }),
    makeResult({ merchant: 'Netflix', quadrant: 'leak', first_tap_ms: 2500, transaction_id: 'tx-netflix' }),
    makeResult({ merchant: 'Deliveroo', quadrant: 'leak', first_tap_ms: 2600, transaction_id: 'tx-deliveroo' }),
  ]

  const transactions = results.map((r) =>
    makeTx(r.transaction_id, r.merchant, 'General'),
  )

  it('detects 3 fastest sharing same quadrant', () => {
    const obs = generateObservations(results, transactions)
    const sp = obs.find((o) => o.rule === 'speed_pattern')
    expect(sp).toBeDefined()
    expect(sp!.merchants).toHaveLength(3)
    expect(sp!.text).toContain('foundation')
    expect(sp!.text).toContain('Rent')
  })
})

// ── Rule 7 — One exception ──────────────────────────────────────────────────

describe('Rule 7 — One exception', () => {
  // 5 out of 11 = 45% investment (dominant, >40%), 1 leak = the exception
  // foundation = 5/11 = 45% (exactly 45%, not >45% so Rule 5 won't fire)
  // Actually, let's use investment as dominant to avoid Rule 5 entirely
  // 5 investment / 10 = 50% (>40%), 4 foundation, 1 leak = the exception
  const results: ValueMapResult[] = [
    makeResult({ merchant: 'Gym', quadrant: 'investment', transaction_id: 'tx-gym' }),
    makeResult({ merchant: 'Udemy', quadrant: 'investment', transaction_id: 'tx-udemy' }),
    makeResult({ merchant: 'Coursera', quadrant: 'investment', transaction_id: 'tx-coursera' }),
    makeResult({ merchant: 'BetterHelp', quadrant: 'investment', transaction_id: 'tx-betterhelp' }),
    makeResult({ merchant: 'Spotify', quadrant: 'investment', transaction_id: 'tx-spotify' }),
    makeResult({ merchant: 'Rent', quadrant: 'foundation', transaction_id: 'tx-rent' }),
    makeResult({ merchant: 'Tesco', quadrant: 'foundation', transaction_id: 'tx-tesco' }),
    makeResult({ merchant: "Sainsbury's", quadrant: 'foundation', transaction_id: 'tx-sainsburys' }),
    makeResult({ merchant: 'EE', quadrant: 'foundation', transaction_id: 'tx-ee' }),
    makeResult({ merchant: 'Deliveroo', quadrant: 'leak', transaction_id: 'tx-deliveroo' }),
  ]

  const transactions = results.map((r) =>
    makeTx(r.transaction_id, r.merchant, 'General'),
  )

  it('detects the single outlier from dominant quadrant', () => {
    const obs = generateObservations(results, transactions)
    const ex = obs.find((o) => o.rule === 'one_exception')
    expect(ex).toBeDefined()
    expect(ex!.merchants).toContain('Deliveroo')
    expect(ex!.text).toContain('investment')
    expect(ex!.text).toContain('leak')
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('returns empty for empty results', () => {
    expect(generateObservations([], [])).toEqual([])
  })

  it('returns empty for fewer than 3 decided results', () => {
    const results: ValueMapResult[] = [
      makeResult({ merchant: 'A', quadrant: 'foundation', transaction_id: 'tx-a' }),
      makeResult({ merchant: 'B', quadrant: 'leak', transaction_id: 'tx-b' }),
    ]
    expect(generateObservations(results, [])).toEqual([])
  })

  it('filters out hard_to_decide results', () => {
    const results: ValueMapResult[] = [
      { transaction_id: 'tx-1', quadrant: null, merchant: 'X', amount: 10, confidence: 0, first_tap_ms: null, card_time_ms: 3000, deliberation_ms: 0, hard_to_decide: true },
      makeResult({ merchant: 'A', quadrant: 'foundation', transaction_id: 'tx-a' }),
      makeResult({ merchant: 'B', quadrant: 'foundation', transaction_id: 'tx-b' }),
      makeResult({ merchant: 'C', quadrant: 'foundation', transaction_id: 'tx-c' }),
    ]
    const obs = generateObservations(results, [])
    // Should not crash, should process the 3 decided results
    expect(obs).toBeDefined()
  })

  it('returns at most 3 observations', () => {
    // Build a profile that triggers many rules
    const results: ValueMapResult[] = [
      makeResult({ merchant: 'PureGym', quadrant: 'leak', confidence: 5, first_tap_ms: 10000, transaction_id: 'tx-puregym' }),
      makeResult({ merchant: 'Headspace', quadrant: 'investment', confidence: 2, first_tap_ms: 1000, transaction_id: 'tx-headspace' }),
      makeResult({ merchant: 'Deliveroo', quadrant: 'leak', confidence: 2, first_tap_ms: 800, transaction_id: 'tx-deliveroo' }),
      makeResult({ merchant: 'Netflix', quadrant: 'leak', confidence: 2, first_tap_ms: 900, transaction_id: 'tx-netflix' }),
      makeResult({ merchant: 'Zara', quadrant: 'leak', confidence: 3, first_tap_ms: 2000, transaction_id: 'tx-zara' }),
      makeResult({ merchant: 'Amazon', quadrant: 'burden', confidence: 2, first_tap_ms: 2000, transaction_id: 'tx-amazon' }),
    ]
    const transactions = [
      makeTx('tx-puregym', 'PureGym', 'Health & Fitness'),
      makeTx('tx-headspace', 'Headspace', 'Health & Fitness'),
      makeTx('tx-deliveroo', 'Deliveroo', 'Dining'),
      makeTx('tx-netflix', 'Netflix', 'Subscriptions'),
      makeTx('tx-zara', 'Zara', 'Shopping'),
      makeTx('tx-amazon', 'Amazon', 'Shopping'),
    ]
    const obs = generateObservations(results, transactions)
    expect(obs.length).toBeLessThanOrEqual(3)
  })

  it('observations are sorted by priority', () => {
    const results: ValueMapResult[] = [
      makeResult({ merchant: 'PureGym', quadrant: 'leak', first_tap_ms: 10000, transaction_id: 'tx-puregym' }),
      makeResult({ merchant: 'Headspace', quadrant: 'investment', first_tap_ms: 1000, transaction_id: 'tx-headspace' }),
      makeResult({ merchant: 'Deliveroo', quadrant: 'leak', first_tap_ms: 800, transaction_id: 'tx-deliveroo' }),
      makeResult({ merchant: 'Netflix', quadrant: 'leak', first_tap_ms: 900, transaction_id: 'tx-netflix' }),
      makeResult({ merchant: 'Zara', quadrant: 'leak', first_tap_ms: 2000, transaction_id: 'tx-zara' }),
    ]
    const transactions = [
      makeTx('tx-puregym', 'PureGym', 'Health & Fitness'),
      makeTx('tx-headspace', 'Headspace', 'Health & Fitness'),
      makeTx('tx-deliveroo', 'Deliveroo', 'Dining'),
      makeTx('tx-netflix', 'Netflix', 'Subscriptions'),
      makeTx('tx-zara', 'Zara', 'Shopping'),
    ]
    const obs = generateObservations(results, transactions)
    for (let i = 1; i < obs.length; i++) {
      expect(obs[i].priority).toBeGreaterThanOrEqual(obs[i - 1].priority)
    }
  })
})
