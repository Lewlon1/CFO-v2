import { describe, it, expect } from 'vitest'
import {
  composeSignals,
  computeDisciplineLabel,
  computeGoalStructure,
  computeHasZeroSpendDays,
  computeSubscriptionDensity,
  extractTopQuadrants,
  normaliseDominantQuadrant,
  uniqueMonths,
  type BuildSignalsInputs,
} from './source-signals'

const emptyValueProfile: BuildSignalsInputs['valueProfile'] = {
  has_personal_data: false,
  top_foundation: [],
  top_leak: [],
}

describe('computeGoalStructure', () => {
  it('returns nameless when no goal exists', () => {
    expect(computeGoalStructure(null)).toBe('nameless')
  })

  it('returns nameless when both target_amount and target_date are missing', () => {
    expect(
      computeGoalStructure({ name: 'Save more', type: 'savings', target_amount: null, target_date: null }),
    ).toBe('nameless')
  })

  it('returns partial when only one of amount/date is set', () => {
    expect(
      computeGoalStructure({ name: 'Save more', type: 'savings', target_amount: 10000, target_date: null }),
    ).toBe('partial')
    expect(
      computeGoalStructure({ name: 'Save more', type: 'savings', target_amount: null, target_date: '2027-01-01' }),
    ).toBe('partial')
  })

  it('returns fully_structured when both amount and date are set', () => {
    expect(
      computeGoalStructure({
        name: 'House deposit',
        type: 'savings',
        target_amount: 50000,
        target_date: '2027-12-01',
      }),
    ).toBe('fully_structured')
  })
})

describe('normaliseDominantQuadrant', () => {
  it('passes through valid lowercase quadrants', () => {
    expect(normaliseDominantQuadrant('foundation')).toBe('foundation')
    expect(normaliseDominantQuadrant('leak')).toBe('leak')
  })

  it('lowercases mixed-case input', () => {
    expect(normaliseDominantQuadrant('Investment')).toBe('investment')
  })

  it('returns null for unknown values', () => {
    expect(normaliseDominantQuadrant('chaotic_neutral')).toBe(null)
    expect(normaliseDominantQuadrant(null)).toBe(null)
    expect(normaliseDominantQuadrant('')).toBe(null)
  })
})

describe('uniqueMonths', () => {
  it('counts distinct YYYY-MM prefixes', () => {
    const months = uniqueMonths([
      { date: '2026-03-01T00:00:00Z' },
      { date: '2026-03-15T00:00:00Z' },
      { date: '2026-04-02T00:00:00Z' },
      { date: '2026-05-30T00:00:00Z' },
    ])
    expect(months).toBe(3)
  })

  it('returns 0 for empty input', () => {
    expect(uniqueMonths([])).toBe(0)
  })
})

describe('computeHasZeroSpendDays', () => {
  it('returns true when no debits exist', () => {
    expect(computeHasZeroSpendDays([{ amount: 3500, date: '2026-03-01' }])).toBe(true)
  })

  it('returns false when debits occur on every day in the window (Dorcas-shape)', () => {
    const txns = Array.from({ length: 28 }, (_, i) => ({
      amount: -25,
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
    }))
    expect(computeHasZeroSpendDays(txns)).toBe(false)
  })

  it('returns true when there are gap days in the debit window', () => {
    expect(
      computeHasZeroSpendDays([
        { amount: -25, date: '2026-03-01' },
        { amount: -25, date: '2026-03-03' },
        { amount: -25, date: '2026-03-07' },
      ]),
    ).toBe(true)
  })
})

describe('computeSubscriptionDensity', () => {
  it('low under 3', () => {
    expect(computeSubscriptionDensity(0)).toBe('low')
    expect(computeSubscriptionDensity(2)).toBe('low')
  })
  it('medium 3..5', () => {
    expect(computeSubscriptionDensity(3)).toBe('medium')
    expect(computeSubscriptionDensity(5)).toBe('medium')
  })
  it('high 6+', () => {
    expect(computeSubscriptionDensity(6)).toBe('high')
    expect(computeSubscriptionDensity(20)).toBe('high')
  })
})

describe('computeDisciplineLabel', () => {
  it('returns unknown with <2 months of data', () => {
    expect(computeDisciplineLabel([])).toBe('unknown')
    expect(
      computeDisciplineLabel([
        { total_income: 3500, total_spending: 1800, spending_by_value_category: { leak: 100 } },
      ]),
    ).toBe('unknown')
  })

  it('returns disciplined when leak share is low and spend CV is low', () => {
    const snapshots = Array.from({ length: 4 }, () => ({
      total_income: 3500,
      total_spending: 2000,
      spending_by_value_category: { foundation: 1500, investment: 350, leak: 50, burden: 100 },
    }))
    expect(computeDisciplineLabel(snapshots)).toBe('disciplined')
  })

  it('returns high_friction when leak share is high', () => {
    const snapshots = Array.from({ length: 3 }, () => ({
      total_income: 3500,
      total_spending: 2000,
      spending_by_value_category: { foundation: 800, investment: 100, leak: 800, burden: 300 },
    }))
    expect(computeDisciplineLabel(snapshots)).toBe('high_friction')
  })

  it('returns inconsistent when leak is moderate but spending is volatile', () => {
    const snapshots = [
      { total_income: 3500, total_spending: 1000, spending_by_value_category: { leak: 200 } },
      { total_income: 3500, total_spending: 3500, spending_by_value_category: { leak: 700 } },
      { total_income: 3500, total_spending: 2200, spending_by_value_category: { leak: 400 } },
    ]
    expect(computeDisciplineLabel(snapshots)).toBe('inconsistent')
  })
})

describe('extractTopQuadrants', () => {
  it('returns empty when no category meets the signal floor', () => {
    const result = extractTopQuadrants(
      { dining: { foundation: 0.9, leak: 0.1 } },
      { dining: 2 },
    )
    expect(result.has_personal_data).toBe(false)
    expect(result.top_foundation).toEqual([])
    expect(result.top_leak).toEqual([])
  })

  it('selects categories with foundation score > 0.5 and ≥3 signals', () => {
    const result = extractTopQuadrants(
      {
        dining: { foundation: 0.8, leak: 0.2 },
        groceries: { foundation: 0.9, leak: 0.1 },
        gambling: { foundation: 0.1, leak: 0.9 },
      },
      { dining: 5, groceries: 12, gambling: 4 },
    )
    expect(result.top_foundation).toEqual(['groceries', 'dining'])
    expect(result.top_leak).toEqual(['gambling'])
    expect(result.has_personal_data).toBe(true)
  })

  it('caps top lists at 3 entries each', () => {
    const byCategory: Record<string, Record<string, number>> = {}
    const signals: Record<string, number> = {}
    for (let i = 0; i < 6; i++) {
      const cat = `leak_cat_${i}`
      byCategory[cat] = { foundation: 0.1, leak: 0.6 + i * 0.05 }
      signals[cat] = 10
    }
    const result = extractTopQuadrants(byCategory, signals)
    expect(result.top_leak.length).toBe(3)
  })
})

describe('composeSignals — fixture shapes', () => {
  it('Lewis-shape: salaried, goal without targets, no Value Map', () => {
    const transactions = [
      { amount: 3500, date: '2026-01-25' },
      { amount: 3500, date: '2026-02-25' },
      { amount: 3500, date: '2026-03-25' },
      { amount: 3500, date: '2026-04-25' },
      // Some debits across days to ensure non-zero-spend day classification
      { amount: -50, date: '2026-04-26' },
      { amount: -50, date: '2026-04-27' },
    ]
    const signals = composeSignals('user-lewis', {
      profile: {
        display_name: 'Lewis',
        country: 'ES',
        primary_currency: 'EUR',
        entry_struggle: 'planning',
        entry_struggle_text: null,
      },
      goal: { name: 'Save more', type: 'savings', target_amount: null, target_date: null },
      valueMapSession: null,
      transactions,
      snapshots: [
        { total_income: 3500, total_spending: 2000, spending_by_value_category: { leak: 100, foundation: 1500 } },
        { total_income: 3500, total_spending: 2100, spending_by_value_category: { leak: 120, foundation: 1500 } },
      ],
      recurringCount: 2,
      valueProfile: emptyValueProfile,
    })

    expect(signals.income.cadence).toBe('monthly')
    expect(signals.income.confidence).toBeGreaterThanOrEqual(0.7)
    expect(signals.goal.present).toBe(true)
    expect(signals.goal.structure_quality).toBe('nameless')
    expect(signals.value_map.completed).toBe(false)
    expect(signals.value_map.has_personal_data).toBe(false)
    expect(signals.entry.struggle_type).toBe('planning')
    expect(signals.behaviour.discipline_label).toBe('disciplined')
    expect(signals.behaviour.subscription_density).toBe('low')
  })

  it('Dorcas-shape: spending every day, no zero-spend gaps, no value map', () => {
    const transactions = [
      { amount: 3500, date: '2026-02-01' },
      { amount: 3500, date: '2026-03-01' },
      { amount: 3500, date: '2026-04-01' },
      ...Array.from({ length: 28 }, (_, i) => ({
        amount: -25,
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      })),
    ]
    const signals = composeSignals('user-dorcas', {
      profile: {
        display_name: 'Dorcas',
        country: 'GB',
        primary_currency: 'GBP',
        entry_struggle: null,
        entry_struggle_text: null,
      },
      goal: null,
      valueMapSession: null,
      transactions,
      snapshots: [],
      recurringCount: 0,
      valueProfile: emptyValueProfile,
    })

    expect(signals.behaviour.has_zero_spend_days).toBe(false)
    expect(signals.behaviour.discipline_label).toBe('unknown')
    expect(signals.goal.present).toBe(false)
  })

  it('no-data: zero transactions, no profile fields, returns sparse signals', () => {
    const signals = composeSignals('user-empty', {
      profile: null,
      goal: null,
      valueMapSession: null,
      transactions: [],
      snapshots: [],
      recurringCount: 0,
      valueProfile: emptyValueProfile,
    })

    expect(signals.income.cadence).toBe('unknown')
    expect(signals.income.confidence).toBe(0)
    expect(signals.behaviour.transaction_count).toBe(0)
    expect(signals.behaviour.months_of_data).toBe(0)
    expect(signals.behaviour.discipline_label).toBe('unknown')
    expect(signals.value_map.completed).toBe(false)
    expect(signals.value_map.has_personal_data).toBe(false)
    expect(signals.value_map.top_foundation_categories).toEqual([])
    expect(signals.value_map.top_leak_categories).toEqual([])
    expect(signals.entry.struggle_type).toBe(null)
    expect(signals.currency).toBe('USD')
  })

  it('Value Map completed but no personal value profile yet', () => {
    const signals = composeSignals('user-vm', {
      profile: {
        display_name: 'Pre-Upload User',
        country: 'GB',
        primary_currency: 'GBP',
        entry_struggle: 'wealth',
        entry_struggle_text: 'I want to know if I am behind',
      },
      goal: null,
      valueMapSession: {
        type: 'perception',
        is_real_data: false,
        dominant_quadrant: 'foundation',
        archetype_name: 'The Builder',
        personality_type: 'builder',
      },
      transactions: [],
      snapshots: [],
      recurringCount: 0,
      valueProfile: emptyValueProfile,
    })

    expect(signals.value_map.completed).toBe(true)
    expect(signals.value_map.archetype).toBe('The Builder')
    expect(signals.value_map.dominant_quadrant).toBe('foundation')
    expect(signals.value_map.has_personal_data).toBe(false)
    expect(signals.entry.struggle_type).toBe('wealth')
    expect(signals.entry.free_text_excerpt).toBe('I want to know if I am behind')
  })

  it('truncates entry_struggle_text excerpt to 80 chars', () => {
    const longText = 'a'.repeat(200)
    const signals = composeSignals('user-x', {
      profile: {
        display_name: null,
        country: null,
        primary_currency: null,
        entry_struggle: 'free_text',
        entry_struggle_text: longText,
      },
      goal: null,
      valueMapSession: null,
      transactions: [],
      snapshots: [],
      recurringCount: 0,
      valueProfile: emptyValueProfile,
    })

    expect(signals.entry.free_text_excerpt?.length).toBe(80)
  })

  it('falls through to value-profile inputs when present', () => {
    const signals = composeSignals('user-archetype', {
      profile: null,
      goal: null,
      valueMapSession: {
        type: 'personal',
        is_real_data: true,
        dominant_quadrant: 'leak',
        archetype_name: 'The Drifter',
        personality_type: null,
      },
      transactions: [],
      snapshots: [],
      recurringCount: 0,
      valueProfile: {
        has_personal_data: true,
        top_foundation: ['groceries', 'transit'],
        top_leak: ['gambling'],
      },
    })

    expect(signals.value_map.has_personal_data).toBe(true)
    expect(signals.value_map.top_foundation_categories).toEqual(['groceries', 'transit'])
    expect(signals.value_map.top_leak_categories).toEqual(['gambling'])
  })
})
