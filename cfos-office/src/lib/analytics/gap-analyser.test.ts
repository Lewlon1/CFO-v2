import { describe, it, expect } from 'vitest'
import { buildMultiIntentLearning } from './gap-analyser'

type Rule = { quadrant: string; signals: number }

function rules(entries: Array<[string, string, number?]>): Map<string, Rule> {
  const m = new Map<string, Rule>()
  for (const [merchant, quadrant, signals] of entries) {
    m.set(merchant.toLowerCase(), { quadrant, signals: signals ?? 1 })
  }
  return m
}

describe('buildMultiIntentLearning', () => {
  it('returns initial when fewer than 3 merchants are labelled', () => {
    const rs = rules([
      ['glovo', 'leak', 4],
      ['deliveroo', 'leak', 2],
    ])
    const result = buildMultiIntentLearning(
      'eat_drinking_out',
      [
        { description: 'GLOVO', absAmount: 30 },
        { description: 'DELIVEROO', absAmount: 20 },
        { description: 'Random pub', absAmount: 50 },
      ],
      rs,
      100,
    )
    expect(result.state).toBe('initial')
  })

  it('returns initial when 3 merchants are labelled but cover <70% of spend', () => {
    const rs = rules([
      ['glovo', 'leak'],
      ['pret', 'foundation'],
      ['aldi', 'foundation'],
    ])
    const result = buildMultiIntentLearning(
      'eat_drinking_out',
      [
        { description: 'GLOVO', absAmount: 20 },
        { description: 'PRET', absAmount: 15 },
        { description: 'ALDI', absAmount: 25 },
        { description: 'BAR SCHUSS', absAmount: 40 }, // unlabelled
      ],
      rs,
      100,
    )
    // labelled total = 60, coverage = 60% — below 70%
    expect(result.state).toBe('initial')
  })

  it('flips to after_labelling when 3+ merchants cover ≥70% of spend', () => {
    const rs = rules([
      ['glovo', 'leak', 5],
      ['pret', 'foundation', 3],
      ['aldi', 'foundation', 8],
    ])
    const result = buildMultiIntentLearning(
      'eat_drinking_out',
      [
        { description: 'GLOVO', absAmount: 30 },
        { description: 'PRET', absAmount: 20 },
        { description: 'ALDI', absAmount: 25 },
        { description: 'BAR SCHUSS', absAmount: 25 }, // unlabelled
      ],
      rs,
      100,
    )
    // labelled total = 75, coverage = 75% — above 70%
    expect(result.state).toBe('after_labelling')
    if (result.state !== 'after_labelling') return
    expect(result.learnedMerchants).toHaveLength(3)
    expect(result.verdict).toMatch(/3 merchants covering 75% of eat_drinking_out/)
  })

  it('learnedMerchants are ordered by amount descending and capped at 5', () => {
    const rs = rules([
      ['m1', 'leak'],
      ['m2', 'leak'],
      ['m3', 'leak'],
      ['m4', 'leak'],
      ['m5', 'leak'],
      ['m6', 'leak'],
      ['m7', 'leak'],
    ])
    const result = buildMultiIntentLearning(
      'cat',
      [
        { description: 'M1', absAmount: 10 },
        { description: 'M2', absAmount: 20 },
        { description: 'M3', absAmount: 30 },
        { description: 'M4', absAmount: 40 },
        { description: 'M5', absAmount: 50 },
        { description: 'M6', absAmount: 60 },
        { description: 'M7', absAmount: 70 },
      ],
      rs,
      280,
    )
    expect(result.state).toBe('after_labelling')
    if (result.state !== 'after_labelling') return
    expect(result.learnedMerchants).toHaveLength(5)
    // Top 5 by amount: m7 (70), m6 (60), m5 (50), m4 (40), m3 (30)
    expect(result.learnedMerchants.map((m) => m.merchant)).toEqual([
      'm7',
      'm6',
      'm5',
      'm4',
      'm3',
    ])
  })

  it('claimableGap aggregates spend per quadrant, omits unsure, sorted desc', () => {
    const rs = rules([
      ['glovo', 'leak'],
      ['deliveroo', 'leak'],
      ['pret', 'foundation'],
      ['gym', 'investment'],
      ['mystery', 'unsure'],
    ])
    const result = buildMultiIntentLearning(
      'mixed_category',
      [
        { description: 'GLOVO', absAmount: 30 },
        { description: 'DELIVEROO', absAmount: 20 },
        { description: 'PRET', absAmount: 15 },
        { description: 'GYM', absAmount: 25 },
        { description: 'MYSTERY', absAmount: 10 }, // unsure — excluded from claimableGap
      ],
      rs,
      100,
    )
    expect(result.state).toBe('after_labelling')
    if (result.state !== 'after_labelling') return
    // Labelled total = 100 (covers 100%), all 5 merchants count for state flip
    expect(result.claimableGap).toEqual([
      { label: 'Leak', amount: 50, quadrant: 'leak' },
      { label: 'Investment', amount: 25, quadrant: 'investment' },
      { label: 'Foundation', amount: 15, quadrant: 'foundation' },
    ])
  })

  it('returns initial when categoryTotal is zero', () => {
    const rs = rules([
      ['glovo', 'leak'],
      ['pret', 'foundation'],
      ['aldi', 'foundation'],
    ])
    const result = buildMultiIntentLearning('cat', [], rs, 0)
    expect(result.state).toBe('initial')
  })

  it('ignores merchant rules with non-quadrant value_category strings', () => {
    const rs = rules([
      ['glovo', 'unknown_quadrant'],
      ['pret', 'foundation'],
      ['aldi', 'foundation'],
    ])
    const result = buildMultiIntentLearning(
      'cat',
      [
        { description: 'GLOVO', absAmount: 50 },
        { description: 'PRET', absAmount: 20 },
        { description: 'ALDI', absAmount: 30 },
      ],
      rs,
      100,
    )
    // glovo's rule is invalid → only 2 labelled merchants → initial
    expect(result.state).toBe('initial')
  })
})
