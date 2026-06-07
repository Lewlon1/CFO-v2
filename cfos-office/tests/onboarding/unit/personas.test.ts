import { describe, it, expect } from 'vitest'
import { PERSONAS } from '../personas'
import { summariseCsv } from '../runner/csv-summariser'

// PERSONAS is the exported array from personas/index.ts — iterate it directly.
const ALL = PERSONAS

describe('persona income/rent realism', () => {
  for (const p of ALL) {
    it(`${p.id}: monthlyIncome and monthlyRent are set`, () => {
      expect(typeof p.profile.monthlyIncome).toBe('number')
      expect(typeof p.profile.monthlyRent).toBe('number')
    })
    it(`${p.id}: monthlyIncome within 25% of CSV-derived monthly income`, () => {
      if (!p.csv) return
      const csv = summariseCsv(Buffer.from(p.csv.contentBase64, 'base64').toString('utf-8'), p.profile.currency)
      const months = Math.max(1, Math.round(
        (new Date(csv.dateRange.to).getTime() - new Date(csv.dateRange.from).getTime()) / (1000 * 60 * 60 * 24 * 30),
      ))
      const csvMonthly = csv.incomeTotal / months
      if (csvMonthly < 100) return // personas with no income rows in CSV — skip
      expect(Math.abs(p.profile.monthlyIncome! - csvMonthly) / csvMonthly).toBeLessThan(0.25)
    })
  }
})

describe('goal coverage + variance', () => {
  const GOAL_PERSONAS = ['builder-classic', 'time-saver-expert', 'tom-long-history', 'truth-teller-balanced', 'sofia-chaotic', 'zane-spain', 'anchor-debt', 'drifter-expat']
  const NO_GOAL_PERSONAS = ['fortress-saver', 'aiko-low-transaction']
  const VALID_TYPES = ['debt_clearance', 'savings', 'investment', 'general'] as const

  it('exactly 8 personas carry a goal', () => {
    const withGoal = ALL.filter((p) => p.expectations.goal)
    expect(withGoal.map((p) => p.id).sort()).toEqual([...GOAL_PERSONAS].sort())
  })

  it('exactly 2 personas have no goal (fortress-saver, aiko-low-transaction)', () => {
    const without = ALL.filter((p) => !p.expectations.goal)
    expect(without.map((p) => p.id).sort()).toEqual([...NO_GOAL_PERSONAS].sort())
  })

  for (const id of GOAL_PERSONAS) {
    const p = ALL.find((x) => x.id === id)!
    it(`${id}: goal.type is a valid DB-constrained value`, () => {
      expect(VALID_TYPES).toContain(p.expectations.goal!.type)
    })
    it(`${id}: goal.targetAmount > 0 and goal.name is non-empty`, () => {
      expect(p.expectations.goal!.targetAmount).toBeGreaterThan(0)
      expect(p.expectations.goal!.name.length).toBeGreaterThan(0)
    })
  }

  it('all 4 goal types are represented across the 8 goal personas', () => {
    const types = GOAL_PERSONAS.map((id) => ALL.find((x) => x.id === id)!.expectations.goal!.type)
    for (const t of VALID_TYPES) {
      expect(types).toContain(t)
    }
  })
})
