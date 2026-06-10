import { describe, it, expect } from 'vitest'
import type { ValueCategoryRule } from '@/lib/parsers/types'
import { planRescore, type RescoreTxn } from './value-rescore'

const rule = (overrides: Partial<ValueCategoryRule>): ValueCategoryRule => ({
  id: 'rule-1',
  match_type: 'merchant',
  match_value: 'tesco',
  value_category: 'foundation',
  confidence: 0.8,
  total_signals: 3,
  agreement_ratio: 1.0,
  avg_amount_low: null,
  avg_amount_high: null,
  time_context: '__none__',
  source: 'learned',
  last_signal_at: null,
  ...overrides,
})

const txn = (overrides: Partial<RescoreTxn>): RescoreTxn => ({
  id: 't-1',
  description: 'TESCO 3297',
  category_id: 'groceries',
  amount: -25,
  date: '2026-01-06T12:00:00Z',
  value_category: 'unsure',
  value_confidence: 0.1,
  value_confirmed_by_user: false,
  prediction_source: 'category_default',
  ...overrides,
})

describe('planRescore — sacred rule', () => {
  it('never plans an update for value_confirmed_by_user rows, even on a rule hit', () => {
    const { updates } = planRescore([txn({ value_confirmed_by_user: true })], [rule({})])
    expect(updates).toHaveLength(0)
  })

  it('never plans an update for prediction_source=user_confirmed rows', () => {
    const { updates } = planRescore(
      [txn({ prediction_source: 'user_confirmed', value_confidence: 1.0 })],
      [rule({})]
    )
    expect(updates).toHaveLength(0)
  })
})

describe('planRescore — rule application', () => {
  it('overwrites a category_default row with the rule verdict and merchant_rule provenance', () => {
    const { scanned, updates } = planRescore([txn({})], [rule({})])
    expect(scanned).toBe(1)
    expect(updates).toEqual([
      {
        id: 't-1',
        month: '2026-01',
        ruleId: 'rule-1',
        value_category: 'foundation',
        value_confidence: 0.8,
        prediction_source: 'merchant_rule',
      },
    ])
  })

  it('rules may emit leak — leak-by-evidence is the design', () => {
    const { updates } = planRescore([txn({})], [rule({ value_category: 'leak' })])
    expect(updates[0]?.value_category).toBe('leak')
  })

  it('leaves rows no rule speaks to untouched (no default re-application)', () => {
    const { updates } = planRescore(
      [txn({ description: 'SOMEWHERE ELSE', category_id: 'entertainment', value_category: 'investment', value_confidence: 0.9, prediction_source: 'recurring_essential' })],
      [rule({})]
    )
    expect(updates).toHaveLength(0)
  })

  it('is idempotent: a row already carrying the rule verdict is not re-planned', () => {
    const first = planRescore([txn({})], [rule({})])
    const after = txn({
      value_category: first.updates[0].value_category,
      value_confidence: first.updates[0].value_confidence,
      prediction_source: first.updates[0].prediction_source,
    })
    expect(planRescore([after], [rule({})]).updates).toHaveLength(0)
  })

  it('tolerates numeric value_confidence arriving as a string from PostgREST', () => {
    const already = txn({ value_category: 'foundation', value_confidence: '0.8', prediction_source: 'merchant_rule' })
    expect(planRescore([already], [rule({})]).updates).toHaveLength(0)
  })
})

describe('planRescore — ruleIds scoping', () => {
  const tescoRule = rule({ id: 'tesco-rule' })
  const aldiRule = rule({ id: 'aldi-rule', match_value: 'aldi', value_category: 'leak' })

  it('considers only transactions the scoped rules target', () => {
    const txns = [
      txn({ id: 'tesco-txn' }),
      txn({ id: 'aldi-txn', description: 'ALDI' }),
    ]
    const { scanned, updates } = planRescore(txns, [tescoRule, aldiRule], ['aldi-rule'])
    expect(scanned).toBe(1)
    expect(updates.map((u) => u.id)).toEqual(['aldi-txn'])
  })

  it('resolves scoped transactions against the FULL rule set — a more specific rule still wins', () => {
    const flatTesco = rule({ id: 'flat', confidence: 0.6, value_category: 'foundation' })
    const lateTesco = rule({ id: 'late', match_type: 'merchant_time', time_context: 'weekday_late', confidence: 0.9, value_category: 'leak' })
    // Tuesday 23:00 UTC → weekday_late (test env runs UTC)
    const lateTxn = txn({ date: '2026-01-06T23:00:00Z' })
    const { updates } = planRescore([lateTxn], [flatTesco, lateTesco], ['flat'])
    expect(updates[0]?.ruleId).toBe('late')
    expect(updates[0]?.value_category).toBe('leak')
  })

  it('returns empty when scoped ids match no rules', () => {
    expect(planRescore([txn({})], [tescoRule], ['nope']).updates).toHaveLength(0)
  })

  it('category-rule scope reaches transactions of that category', () => {
    const catRule = rule({ id: 'cat', match_type: 'category', match_value: 'groceries', confidence: 0.7 })
    const { updates } = planRescore(
      [txn({ description: 'UNKNOWN GROCER' })],
      [catRule],
      ['cat']
    )
    expect(updates[0]?.prediction_source).toBe('category_rule')
  })
})
