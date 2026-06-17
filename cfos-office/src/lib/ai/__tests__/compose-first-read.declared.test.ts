import { describe, it, expect } from 'vitest'
import { buildDeclaredFacts } from '../compose-first-read'

describe('buildDeclaredFacts', () => {
  it('computes free cash and goal pace from declared numbers', () => {
    const facts = buildDeclaredFacts({
      income: 3100,
      totalFixedCosts: 1850,
      goal: { name: 'House deposit', monthlyRequiredSaving: 600 },
      currency: 'GBP',
    })
    expect(facts.freeCash).toBe(1250)            // 3100 - 1850
    expect(facts.goalName).toBe('House deposit')
    expect(facts.percentOfIncome).toBe(19)       // round(600/3100*100)
    expect(facts.unallocated).toBe(650)          // 1250 free cash - 600 contribution
  })
  it('handles no goal', () => {
    const facts = buildDeclaredFacts({ income: 2000, totalFixedCosts: 1200, goal: null, currency: 'EUR' })
    expect(facts.freeCash).toBe(800)
    expect(facts.goalName).toBeNull()
    expect(facts.percentOfIncome).toBeNull()
    expect(facts.unallocated).toBeNull()         // no pace to subtract
  })
  it('floors the modelled cushion at zero when the contribution exceeds free cash', () => {
    const facts = buildDeclaredFacts({
      income: 2000,
      totalFixedCosts: 1500,
      goal: { name: 'Stretch goal', monthlyRequiredSaving: 800 },
      currency: 'EUR',
    })
    expect(facts.freeCash).toBe(500)
    expect(facts.unallocated).toBe(0)            // max(0, 500 - 800)
  })
  it('floors free cash at zero when fixed costs exceed income', () => {
    const facts = buildDeclaredFacts({ income: 1000, totalFixedCosts: 1500, goal: null, currency: 'GBP' })
    expect(facts.freeCash).toBe(0)
  })
  it('returns null percentOfIncome when income is zero (no divide-by-zero)', () => {
    const facts = buildDeclaredFacts({
      income: 0,
      totalFixedCosts: 0,
      goal: { name: 'X', monthlyRequiredSaving: 100 },
      currency: 'GBP',
    })
    expect(facts.percentOfIncome).toBeNull()
  })
})
