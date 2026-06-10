import { describe, it, expect } from 'vitest'
import type { ValueCategoryRule } from '@/lib/parsers/types'
import { normaliseMerchant } from './normalise-merchant'
import { RULE_APPLICATION_MIN_CONFIDENCE } from './value-config'
import { matchValueRule } from './value-rule-matcher'

const rule = (overrides: Partial<ValueCategoryRule>): ValueCategoryRule => ({
  id: 'rule-id',
  match_type: 'merchant',
  match_value: 'tesco',
  value_category: 'foundation',
  confidence: 0.7,
  total_signals: 3,
  agreement_ratio: 1.0,
  avg_amount_low: null,
  avg_amount_high: null,
  time_context: '__none__',
  source: 'learned',
  last_signal_at: null, // no recency boost unless a test opts in
  ...overrides,
})

// Tuesday 2026-01-06: 12:00 → weekday_midday, 23:00 → weekday_late
const MIDDAY = new Date('2026-01-06T12:00:00')
const LATE = new Date('2026-01-06T23:00:00')

const txn = (overrides: Partial<Parameters<typeof matchValueRule>[0]> = {}) => ({
  description: 'TESCO 3297',
  categoryId: 'groceries' as string | null,
  amount: -25,
  date: MIDDAY,
  ...overrides,
})

describe('matchValueRule — specificity precedence', () => {
  it('merchant_time beats merchant when the time context matches', () => {
    const rules = [
      rule({ id: 'time', match_type: 'merchant_time', time_context: 'weekday_late', value_category: 'leak', confidence: 0.6 }),
      rule({ id: 'flat', match_type: 'merchant', value_category: 'foundation', confidence: 0.9 }),
    ]
    const m = matchValueRule(txn({ date: LATE }), rules)
    expect(m?.matchType).toBe('merchant_time')
    expect(m?.valueCategory).toBe('leak')
    expect(m?.ruleId).toBe('time')
  })

  it('merchant_time misses outside its bucket and the flat merchant rule wins', () => {
    const rules = [
      rule({ id: 'time', match_type: 'merchant_time', time_context: 'weekday_late', value_category: 'leak', confidence: 0.6 }),
      rule({ id: 'flat', match_type: 'merchant', value_category: 'foundation', confidence: 0.9 }),
    ]
    const m = matchValueRule(txn({ date: MIDDAY }), rules)
    expect(m?.matchType).toBe('merchant')
    expect(m?.valueCategory).toBe('foundation')
  })

  it('merchant beats category; category beats global', () => {
    const rules = [
      rule({ id: 'm', match_type: 'merchant', value_category: 'investment', confidence: 0.6 }),
      rule({ id: 'c', match_type: 'category', match_value: 'groceries', value_category: 'foundation', confidence: 0.9 }),
      rule({ id: 'g', match_type: 'global', match_value: '__global__', value_category: 'burden', confidence: 0.9 }),
    ]
    expect(matchValueRule(txn(), rules)?.matchType).toBe('merchant')
    expect(matchValueRule(txn({ description: 'OTHER SHOP' }), rules)?.matchType).toBe('category')
    expect(matchValueRule(txn({ description: 'OTHER SHOP', categoryId: null }), rules)?.matchType).toBe('global')
  })

  it('within a tier the highest-confidence rule wins', () => {
    const rules = [
      rule({ id: 'low', match_type: 'merchant', value_category: 'leak', confidence: 0.55 }),
      rule({ id: 'high', match_type: 'merchant', value_category: 'investment', confidence: 0.8, time_context: null }),
    ]
    const m = matchValueRule(txn(), rules)
    expect(m?.ruleId).toBe('high')
    expect(m?.valueCategory).toBe('investment')
  })
})

describe('matchValueRule — amount bands', () => {
  const bands = [
    rule({ id: 'low-band', match_type: 'merchant_amount', value_category: 'foundation', confidence: 0.6, avg_amount_low: null, avg_amount_high: 20 }),
    rule({ id: 'high-band', match_type: 'merchant_amount', value_category: 'leak', confidence: 0.6, avg_amount_low: 20, avg_amount_high: null }),
  ]

  it('matches the band containing |amount| (sign-insensitive)', () => {
    expect(matchValueRule(txn({ amount: -50 }), bands)?.ruleId).toBe('high-band')
    expect(matchValueRule(txn({ amount: -10 }), bands)?.ruleId).toBe('low-band')
  })

  it('band bounds are inclusive; a null bound is open', () => {
    const m = matchValueRule(txn({ amount: -20 }), bands)
    // 20 sits in BOTH inclusive bands — equal confidence, first match wins
    expect(m).not.toBeNull()
    const onlyHigh = [bands[1]]
    expect(matchValueRule(txn({ amount: -19.99 }), onlyHigh)).toBeNull()
    expect(matchValueRule(txn({ amount: -20 }), onlyHigh)?.ruleId).toBe('high-band')
  })
})

describe('matchValueRule — application floor', () => {
  it('returns null when the best candidate sits below RULE_APPLICATION_MIN_CONFIDENCE', () => {
    const rules = [rule({ confidence: RULE_APPLICATION_MIN_CONFIDENCE - 0.01 })]
    expect(matchValueRule(txn(), rules)).toBeNull()
  })

  it('applies a rule exactly at the floor', () => {
    const rules = [rule({ confidence: RULE_APPLICATION_MIN_CONFIDENCE })]
    expect(matchValueRule(txn(), rules)?.confidence).toBe(RULE_APPLICATION_MIN_CONFIDENCE)
  })

  it('checks the floor on raw confidence, before the recency boost', () => {
    const rules = [rule({ confidence: 0.48, last_signal_at: new Date().toISOString() })]
    expect(matchValueRule(txn(), rules)).toBeNull() // 0.48 + 0.05 boost would clear it; raw does not
  })

  it('a sub-floor specific rule does not block a flat rule above the floor', () => {
    const rules = [
      rule({ id: 'time', match_type: 'merchant_time', time_context: 'weekday_midday', value_category: 'leak', confidence: 0.45 }),
      rule({ id: 'flat', match_type: 'merchant', value_category: 'foundation', confidence: 0.7 }),
    ]
    expect(matchValueRule(txn(), rules)?.ruleId).toBe('flat')
  })
})

describe('matchValueRule — normalisation parity', () => {
  it('matches through the shared normaliser exactly as the rule writers wrote it', () => {
    const raw = 'CARD PAYMENT TO HYPEROPTIC DD (Direct Debit) Reference: 1HYP0009'
    const rules = [rule({ match_value: normaliseMerchant(raw), value_category: 'burden', confidence: 0.8 })]
    expect(matchValueRule(txn({ description: raw }), rules)?.valueCategory).toBe('burden')
  })

  it('a precomputed merchantClean gives the same result as the raw description', () => {
    const raw = 'AMZN Mktp UK*AB12CD'
    const rules = [rule({ match_value: normaliseMerchant(raw), confidence: 0.8 })]
    const viaDescription = matchValueRule(txn({ description: raw }), rules)
    const viaClean = matchValueRule(txn({ description: raw, merchantClean: normaliseMerchant(raw) }), rules)
    expect(viaDescription).toEqual(viaClean)
  })

  it('does not substring-match merchants (exact normalised equality only)', () => {
    const rules = [rule({ match_value: 'tesco', confidence: 0.9 })]
    expect(matchValueRule(txn({ description: 'NOT REALLY TESCO EXPRESS LTD' }), rules)).toBeNull()
  })
})

describe('matchValueRule — plain-rule time sentinel and boost', () => {
  it('accepts the __none__ sentinel and legacy null for plain rules', () => {
    expect(matchValueRule(txn(), [rule({ time_context: '__none__' })])).not.toBeNull()
    expect(matchValueRule(txn(), [rule({ time_context: null })])).not.toBeNull()
  })

  it('a time-bucket string on a plain merchant rule prevents the plain match', () => {
    expect(matchValueRule(txn(), [rule({ time_context: 'weekday_late' })])).toBeNull()
  })

  it('applies the recency boost to the returned confidence, capped at 0.99', () => {
    const fresh = rule({ confidence: 0.7, last_signal_at: new Date().toISOString() })
    expect(matchValueRule(txn(), [fresh])?.confidence).toBe(0.75)
    const maxed = rule({ confidence: 0.97, last_signal_at: new Date().toISOString() })
    expect(matchValueRule(txn(), [maxed])?.confidence).toBe(0.99)
  })

  it('skips time tiers when timeContext is explicitly null and no date is given', () => {
    const rules = [
      rule({ id: 'time', match_type: 'merchant_time', time_context: 'weekday_midday', confidence: 0.9 }),
      rule({ id: 'flat', match_type: 'merchant', confidence: 0.6 }),
    ]
    const m = matchValueRule({ description: 'TESCO', categoryId: null, amount: -5, timeContext: null }, rules)
    expect(m?.ruleId).toBe('flat')
  })
})
