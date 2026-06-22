import { describe, it, expect } from 'vitest'
import { buildDeclaredFacts } from '../compose-first-read'
import { buildDeclaredUserPrompt } from '../prompts/first-read'

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

  it('non-investment goals are never funded-at-plan', () => {
    const facts = buildDeclaredFacts({
      income: 3100,
      totalFixedCosts: 1850,
      goal: { name: 'House deposit', type: 'savings', monthlyRequiredSaving: 600 },
      currency: 'GBP',
    })
    expect(facts.fundedAtPlan).toBe(false)
    expect(facts.stressMonthly).toBeNull()
  })

  it('flags an investment goal funded at plan (£0/mo) as on track, with a conservative stress case', () => {
    const facts = buildDeclaredFacts({
      income: 3500,
      totalFixedCosts: 495,
      goal: {
        name: 'Retirement pot',
        type: 'investment',
        targetAmount: 600000,
        currentAmount: 400000,
        targetDate: '2034-06-18',
        monthlyRequiredSaving: 0,
      },
      currency: 'GBP',
    })
    expect(facts.fundedAtPlan).toBe(true)
    expect(facts.monthlyRequiredSaving).toBe(0)
    expect(typeof facts.planRatePct).toBe('number')
    // conservative rate is the cautious end, below the plan rate
    expect(facts.stressRatePct).not.toBeNull()
    expect(facts.stressRatePct! < facts.planRatePct!).toBe(true)
    // 400k → 600k at the cautious rate still needs a positive monthly
    expect(facts.stressMonthly).not.toBeNull()
    expect(facts.stressMonthly!).toBeGreaterThan(0)
    expect(typeof facts.stressCovered).toBe('boolean')
  })

  it('an investment goal with a real monthly requirement is NOT funded-at-plan', () => {
    const facts = buildDeclaredFacts({
      income: 3500,
      totalFixedCosts: 495,
      goal: {
        name: 'Retirement pot',
        type: 'investment',
        targetAmount: 600000,
        currentAmount: 50000,
        targetDate: '2034-06-18',
        monthlyRequiredSaving: 2500,
      },
      currency: 'GBP',
    })
    expect(facts.fundedAtPlan).toBe(false)
  })

  it('the prompt frames a funded-at-plan goal as on track, never "unspoken-for"', () => {
    const facts = buildDeclaredFacts({
      income: 3500,
      totalFixedCosts: 495,
      goal: {
        name: 'Retirement pot',
        type: 'investment',
        targetAmount: 600000,
        currentAmount: 400000,
        targetDate: '2034-06-18',
        monthlyRequiredSaving: 0,
      },
      currency: 'GBP',
    })
    const prompt = buildDeclaredUserPrompt(facts)
    expect(prompt).toMatch(/ON TRACK|FUNDED AT PLAN/)
    // The funded-at-plan branch replaces the "£0/mo + unspoken-for cushion" lines
    expect(prompt).not.toMatch(/Monthly contribution needed/)
    expect(prompt).not.toMatch(/is still unspoken-for/)
  })
})
