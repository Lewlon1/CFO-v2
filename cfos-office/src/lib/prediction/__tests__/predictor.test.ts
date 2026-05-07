import { describe, it, expect } from 'vitest'
import { resolveValueCategory } from '../predictor'
import type { ValueCategoryRule, Category } from '@/lib/parsers/types'

const rule = (overrides: Partial<ValueCategoryRule>): ValueCategoryRule => ({
  match_type: 'merchant',
  match_value: 'tesco',
  value_category: 'foundation',
  confidence: 0.70,
  total_signals: 3,
  agreement_ratio: 1.0,
  avg_amount_low: null,
  avg_amount_high: null,
  time_context: null,
  source: 'learned',
  last_signal_at: new Date().toISOString(),
  ...overrides,
})

const categories: Category[] = [
  {
    id: 'groceries', name: 'Groceries', tier: 'core', icon: 'apple',
    color: 'green', examples: [], default_value_category: 'foundation',
  },
  {
    id: 'entertainment', name: 'Entertainment', tier: 'lifestyle', icon: 'tv',
    color: 'purple', examples: [], default_value_category: null,
  },
]

describe('resolveValueCategory', () => {
  it('returns merchant_time rule when it exists and matches time context', () => {
    const rules = [
      rule({ match_type: 'merchant_time', time_context: 'weekday_late', value_category: 'leak', confidence: 0.57 }),
      rule({ match_type: 'merchant', value_category: 'foundation', confidence: 0.70 }),
    ]
    // Tuesday 23:00 → weekday_late
    const result = resolveValueCategory(rules, categories, 'tesco', 'groceries', 10, new Date('2026-01-06T23:00:00'))
    expect(result.value_category).toBe('leak')
    expect(result.source).toBe('merchant_time')
  })

  it('falls back to merchant flat rule when no time rule matches', () => {
    const rules = [
      rule({ match_type: 'merchant_time', time_context: 'weekday_late', value_category: 'leak', confidence: 0.57 }),
      rule({ match_type: 'merchant', value_category: 'foundation', confidence: 0.70 }),
    ]
    // Tuesday 12:00 → weekday_midday (no time rule for this)
    const result = resolveValueCategory(rules, categories, 'tesco', 'groceries', 10, new Date('2026-01-06T12:00:00'))
    expect(result.value_category).toBe('foundation')
    expect(result.source).toBe('merchant')
  })

  it('matches merchant_amount rule when amount falls in band', () => {
    const rules = [
      rule({ match_type: 'merchant_amount', value_category: 'foundation', confidence: 0.60, avg_amount_low: null, avg_amount_high: 20 }),
      rule({ match_type: 'merchant_amount', value_category: 'leak', confidence: 0.60, avg_amount_low: 20, avg_amount_high: null }),
    ]
    const result = resolveValueCategory(rules, categories, 'tesco', 'groceries', -50, new Date('2026-01-06T12:00:00'))
    expect(result.value_category).toBe('leak')
    expect(result.source).toBe('merchant_amount')
  })

  it('falls through to category rule when no merchant rule exists', () => {
    const rules = [
      rule({ match_type: 'category', match_value: 'groceries', value_category: 'foundation', confidence: 0.40 }),
    ]
    const result = resolveValueCategory(rules, categories, 'unknown_shop', 'groceries', 10, new Date('2026-01-06T12:00:00'))
    expect(result.value_category).toBe('foundation')
    expect(result.source).toBe('category')
  })

  it('falls through to global prior when no category rule exists', () => {
    const rules = [
      rule({ match_type: 'global', match_value: '__global__', value_category: 'foundation', confidence: 0.30 }),
    ]
    const result = resolveValueCategory(rules, categories, 'unknown', null, 10, new Date('2026-01-06T12:00:00'))
    expect(result.value_category).toBe('foundation')
    expect(result.source).toBe('global')
  })

  it('falls through to category_default when no rules match', () => {
    const result = resolveValueCategory([], categories, 'tesco', 'groceries', 10, new Date('2026-01-06T12:00:00'))
    expect(result.value_category).toBe('foundation')
    expect(result.confidence).toBe(0.15)
    expect(result.source).toBe('category_default')
  })

  it('returns null when no rules match and category has no default', () => {
    const result = resolveValueCategory([], categories, 'netflix', 'entertainment', 10, new Date('2026-01-06T12:00:00'))
    expect(result.value_category).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.source).toBe('none')
  })

  it('skips rules below confidence threshold', () => {
    const rules = [
      rule({ match_type: 'merchant', value_category: 'leak', confidence: 0.20 }), // below 0.25 threshold
      rule({ match_type: 'category', match_value: 'groceries', value_category: 'foundation', confidence: 0.40 }),
    ]
    const result = resolveValueCategory(rules, categories, 'tesco', 'groceries', 10, new Date('2026-01-06T12:00:00'))
    expect(result.value_category).toBe('foundation')
    expect(result.source).toBe('category')
  })

  it('applies recency boost for recent rules', () => {
    const recentRule = rule({
      match_type: 'merchant',
      confidence: 0.70,
      last_signal_at: new Date().toISOString(), // today
    })
    const result = resolveValueCategory([recentRule], categories, 'tesco', 'groceries', 10, new Date('2026-01-06T12:00:00'))
    expect(result.confidence).toBe(0.75)
  })

  it('no recency boost for rules older than 90 days', () => {
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 100)
    const oldRule = rule({
      match_type: 'merchant',
      confidence: 0.70,
      last_signal_at: oldDate.toISOString(),
    })
    const result = resolveValueCategory([oldRule], categories, 'tesco', 'groceries', 10, new Date('2026-01-06T12:00:00'))
    expect(result.confidence).toBe(0.70)
  })
})
