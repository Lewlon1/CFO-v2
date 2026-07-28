import { describe, it, expect } from 'vitest'
import { buildDeclaredFacts, buildDeclaredDelta } from '../compose-first-read'
import { buildDeclaredUserPrompt } from '../prompts/first-read'
import { monthsBetween } from '@/lib/goals/pace'

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

  it('threads the goal target / saved / date figures through', () => {
    const facts = buildDeclaredFacts({
      income: 2800,
      totalFixedCosts: 900,
      goal: {
        name: 'House deposit',
        monthlyRequiredSaving: 1750,
        targetAmount: 40_000,
        currentAmount: 5_000,
        targetDate: '2028-03-01',
      },
      currency: 'GBP',
    })
    expect(facts.goalTargetAmount).toBe(40_000)
    expect(facts.goalCurrentAmount).toBe(5_000)
    expect(facts.goalTargetDate).toBe('2028-03-01')
  })

  it('falls back to a straight-line pace when the goal has a dated target but no stored pace', () => {
    const targetDate = '2032-06-01' // far future so monthsLeft > 0 for the test's lifetime
    const facts = buildDeclaredFacts({
      income: 2800,
      totalFixedCosts: 900,
      goal: {
        name: 'House deposit',
        monthlyRequiredSaving: null,
        targetAmount: 40_000,
        currentAmount: 5_000,
        targetDate,
      },
      currency: 'GBP',
    })
    // Same netting as computePaceAndOnTrack: (target − current) / monthsLeft.
    const expected = Math.round((40_000 - 5_000) / monthsBetween(new Date(), new Date(targetDate)))
    expect(facts.monthlyRequiredSaving).toBe(expected)
    expect(facts.unallocated).toBe(Math.max(0, facts.freeCash - expected))
  })

  it('never straight-lines an investment goal (compound-growth pace is the only source)', () => {
    const facts = buildDeclaredFacts({
      income: 2800,
      totalFixedCosts: 900,
      goal: {
        name: 'Index pot',
        monthlyRequiredSaving: null,
        targetAmount: 100_000,
        currentAmount: 10_000,
        targetDate: '2040-01-01',
        type: 'investment',
      },
      currency: 'GBP',
    })
    expect(facts.monthlyRequiredSaving).toBeNull()
    expect(facts.goalTargetAmount).toBe(100_000) // target still cited, pace withheld
  })

  it('no fallback pace when the target is already reached', () => {
    const facts = buildDeclaredFacts({
      income: 2800,
      totalFixedCosts: 900,
      goal: {
        name: 'Done goal',
        monthlyRequiredSaving: null,
        targetAmount: 5_000,
        currentAmount: 6_000,
        targetDate: '2032-06-01',
      },
      currency: 'GBP',
    })
    expect(facts.monthlyRequiredSaving).toBeNull()
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

describe('buildDeclaredDelta', () => {
  const snapshot = { totalFixedCosts: 1850, freeCash: 1250, currency: 'EUR' }

  it('computes both signed differences from snapshot vs fresh facts', () => {
    const delta = buildDeclaredDelta(snapshot, {
      total_fixed_costs: 2140,
      free_cash_flow: 960,
    })
    expect(delta).toEqual({
      declaredFixedCosts: 1850,
      declaredFreeCash: 1250,
      actualFixedCosts: 2140,
      actualFreeCash: 960,
      fixedCostsDiff: 290,
      freeCashDiff: -290,
      // No reconciled items passed — the band reconciliation is empty, never
      // undefined, so the prompt formatter can branch on length alone.
      bands: [],
      unverified: [],
      undeclared: [],
      currency: 'EUR',
    })
  })

  it('returns null when the actual side is entirely missing', () => {
    expect(
      buildDeclaredDelta(snapshot, { total_fixed_costs: null, free_cash_flow: null }),
    ).toBeNull()
  })

  it('carries a null diff for the missing half when only one actual figure exists', () => {
    const delta = buildDeclaredDelta(snapshot, {
      total_fixed_costs: 2140,
      free_cash_flow: null,
    })
    expect(delta?.fixedCostsDiff).toBe(290)
    expect(delta?.actualFreeCash).toBeNull()
    expect(delta?.freeCashDiff).toBeNull()
  })
})
