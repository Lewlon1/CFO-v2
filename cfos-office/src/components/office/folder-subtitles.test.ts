import { describe, expect, it } from 'vitest'
import {
  cashFlowSubtitle,
  netWorthSubtitle,
  valuesSubtitle,
  scenariosSubtitle,
} from './folder-subtitles'
import type { PrimaryGoal } from '@/lib/goals/primary-goal'

const goal: PrimaryGoal = {
  id: 'g1',
  name: 'Emergency fund',
  target_amount: 10000,
  current_amount: 2500,
  target_date: '2026-12-31',
  monthly_required_saving: 500,
  on_track: true,
  priority: 'high',
  created_at: '2026-01-01',
}

describe('cashFlowSubtitle', () => {
  it('surplus + goal → feeds-goal connection', () => {
    expect(cashFlowSubtitle({ surplus_deficit: 460 }, goal, 'fallback'))
      .toBe('€460 surplus this month · feeds your goal')
  })

  it('surplus + no goal → neutral surplus', () => {
    expect(cashFlowSubtitle({ surplus_deficit: 460 }, null, 'fallback'))
      .toBe('€460 surplus this month')
  })

  it('deficit + goal → no goal commentary (state the fact)', () => {
    expect(cashFlowSubtitle({ surplus_deficit: -120 }, goal, 'fallback'))
      .toBe('€120 short this month')
  })

  it('deficit + no goal → bare deficit', () => {
    expect(cashFlowSubtitle({ surplus_deficit: -120 }, null, 'fallback'))
      .toBe('€120 short this month')
  })

  it('zero + goal → "Even" (no goal commentary on a flat month)', () => {
    expect(cashFlowSubtitle({ surplus_deficit: 0 }, goal, 'fallback'))
      .toBe('Even this month')
  })

  it('zero + no goal → "Even"', () => {
    expect(cashFlowSubtitle({ surplus_deficit: 0 }, null, 'fallback'))
      .toBe('Even this month')
  })

  it('null summary → caller-provided fallback', () => {
    expect(cashFlowSubtitle(null, goal, 'May 2026 · 47 transactions'))
      .toBe('May 2026 · 47 transactions')
  })

  it('undefined summary → caller-provided fallback', () => {
    expect(cashFlowSubtitle(undefined, null, 'This month · 0 transactions'))
      .toBe('This month · 0 transactions')
  })

  it('formats surplus with thousands separator', () => {
    expect(cashFlowSubtitle({ surplus_deficit: 12345 }, goal, 'fallback'))
      .toBe('€12,345 surplus this month · feeds your goal')
  })
})

describe('netWorthSubtitle', () => {
  it('positive net + goal → goal-lives-here', () => {
    expect(netWorthSubtitle(50000, 7820, goal))
      .toBe('€42,180 net worth · the goal lives here')
  })

  it('positive net + no goal → bare figure', () => {
    expect(netWorthSubtitle(50000, 7820, null))
      .toBe('€42,180 net worth')
  })

  it('negative net + goal → negative figure with goal line', () => {
    expect(netWorthSubtitle(1000, 5000, goal))
      .toBe('-€4,000 net worth · the goal lives here')
  })

  it('negative net + no goal → bare negative figure', () => {
    expect(netWorthSubtitle(1000, 5000, null))
      .toBe('-€4,000 net worth')
  })

  it('all zero + goal → CTA, no figure', () => {
    expect(netWorthSubtitle(0, 0, goal))
      .toBe('Add what you own and owe')
  })

  it('all zero + no goal → CTA', () => {
    expect(netWorthSubtitle(0, 0, null))
      .toBe('Add what you own and owe')
  })

  it('assets only (no liabilities) + goal → still shows figure', () => {
    expect(netWorthSubtitle(15000, 0, goal))
      .toBe('€15,000 net worth · the goal lives here')
  })
})

describe('valuesSubtitle', () => {
  it('archetype + goal → patterns-under-goal', () => {
    expect(valuesSubtitle('Architect', 87, goal))
      .toBe('Architect · the patterns under your goal')
  })

  it('archetype + no goal → existing %-profiled format', () => {
    expect(valuesSubtitle('Architect', 87, null))
      .toBe('Architect · 87% profiled')
  })

  it('archetype + no goal rounds completeness', () => {
    expect(valuesSubtitle('Architect', 86.7, null))
      .toBe('Architect · 87% profiled')
  })

  it('no archetype + goal → build-portrait + goal connection', () => {
    expect(valuesSubtitle(null, 0, goal))
      .toBe('Build your portrait — the patterns under your goal')
  })

  it('no archetype + no goal → bare build-portrait CTA', () => {
    expect(valuesSubtitle(null, 0, null))
      .toBe('Build your portrait')
  })
})

describe('scenariosSubtitle', () => {
  it('goal → goal-pace framing', () => {
    expect(scenariosSubtitle(goal)).toBe("What shifts your goal's pace")
  })

  it('no goal → existing what-if', () => {
    expect(scenariosSubtitle(null)).toBe('What if...')
  })
})
