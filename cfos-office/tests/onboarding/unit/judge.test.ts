import { describe, it, expect } from 'vitest'
import { readContent, evaluateHardRules } from '../runner/judge'
import { summariseCsv } from '../runner/csv-summariser'
import { builderClassic } from '../personas/builder-classic'
import { zaneSpain } from '../personas/zane-spain'
import { loadRead, listReads } from '../fixtures'

describe('readContent', () => {
  it('unwraps the message wrapper object to its content string', () => {
    const wrapper = { conversationType: 'first_read', content: 'Body line.\n\n— C.', messageId: 'abc' }
    expect(readContent(wrapper)).toBe('Body line.\n\n— C.')
  })
  it('passes a plain string through unchanged', () => {
    expect(readContent('plain')).toBe('plain')
  })
})

describe('evaluateHardRules: signoff on unwrapped content', () => {
  it('passes H1_signoff_present for a Read ending in "— C." (no JSON wrapper)', () => {
    const read = 'Housing is £1,100 of your spend.\n\n[CTA:set_goal]Set a goal[/CTA]\n\n— C.'
    const rules = evaluateHardRules(builderClassic, 'insight', read, null)
    const h1 = rules.find((r) => r.ruleId === 'H1_signoff_present')
    expect(h1?.passed).toBe(true)
  })

  it('H1_signoff_present passes when judged via the wrapper object (the original bug)', () => {
    const wrapper = {
      conversationType: 'first_read',
      content: 'Housing is £1,100.\n\n[CTA:set_goal]Set a goal[/CTA]\n\n— C.',
      messageId: 'abc',
    }
    const content = readContent(wrapper)
    const rules = evaluateHardRules(builderClassic, 'insight', content, null)
    expect(rules.find((r) => r.ruleId === 'H1_signoff_present')?.passed).toBe(true)
  })
})

// Multi-month so spendingTotal (4000) exceeds the computed monthly facts the
// Read legitimately quotes (fixed costs, FCF) — those must NOT be flagged.
const TINY_CSV = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  'CARD_PAYMENT,2026-01-01,Rent Landlord,-1100.00,GBP,0',
  'CARD_PAYMENT,2026-02-01,Rent Landlord,-1100.00,GBP,0',
  'CARD_PAYMENT,2026-03-01,Rent Landlord,-1100.00,GBP,0',
  'CARD_PAYMENT,2026-01-15,Tesco,-300.00,GBP,0',
  'CARD_PAYMENT,2026-02-15,Tesco,-300.00,GBP,0',
  'CARD_PAYMENT,2026-01-20,Farmer J,-100.00,GBP,0',
].join('\n')

describe('R4 minimal numbers', () => {
  const csv = summariseCsv(TINY_CSV, 'GBP') // spendingTotal = 4000; amounts {1100,300,100}
  const run = (read: string) =>
    evaluateHardRules(builderClassic, 'insight', read, csv).find((r) => r.ruleId === 'R4_numbers_match_csv')

  it('passes years, percentages, counts (not currency-anchored)', () => {
    expect(run('In 2026, 70% across 14 transactions. £1,100 rent.\n\n— C.')?.passed).toBe(true)
  })
  it('passes computed facts below total spend (£1,717 fixed costs, £1,283 FCF)', () => {
    expect(run('Fixed costs £1,717/month; free cash flow £1,283.\n\n— C.')?.passed).toBe(true)
  })
  it('passes a thousands-comma amount that matches a CSV figure (== spendingTotal)', () => {
    expect(run('You tracked £4,000 in total.\n\n— C.')?.passed).toBe(true)
  })
  it('flags an egregious hallucinated amount exceeding total spend', () => {
    const r = run('Your portfolio holds £250,000.\n\n— C.')
    expect(r?.passed).toBe(false)
    expect(r?.detail).toContain('250000')
  })
})

describe('fixtures', () => {
  it('loads the captured corpus', () => {
    expect(listReads().length).toBeGreaterThanOrEqual(18) // 25 fixtures: 10 captured + 8 gbp + 7 bad (loose lower bound)
    expect(loadRead('zane-spain.captured')).toMatch(/— C\.\s*$/)
  })
})

describe('R5 currency symbol', () => {
  const r5 = (persona: typeof builderClassic, read: string) =>
    evaluateHardRules(persona, 'insight', read, null).find((r) => r.ruleId === 'R5_currency_symbol')

  it('fails a GBP persona whose Read uses €', () => {
    expect(r5(builderClassic, loadRead('builder-classic.captured'))?.passed).toBe(false)
  })
  it('passes a GBP persona whose Read uses £', () => {
    expect(r5(builderClassic, loadRead('builder-classic.gbp'))?.passed).toBe(true)
  })
  it('passes a EUR persona whose Read uses €', () => {
    expect(r5(zaneSpain, loadRead('zane-spain.captured'))?.passed).toBe(true)
  })
})

describe('R6 goal-denial / R7 system-note', () => {
  // builderClassic seeds a goal after Task 9; for this unit we fake it inline:
  const withGoal = { ...builderClassic, expectations: { ...builderClassic.expectations, goal: { name: 'X', targetAmount: 1 } } }
  const noGoal = { ...builderClassic, expectations: { ...builderClassic.expectations, goal: undefined } }
  const r = (p: typeof builderClassic, read: string, id: string) =>
    evaluateHardRules(p, 'insight', read, null).find((x) => x.ruleId === id)

  it('R6 fails when a goal-persona Read denies the goal', () => {
    expect(r(withGoal, loadRead('bad-goal-denial'), 'R6_no_goal_denial')?.passed).toBe(false)
  })
  it('R6 is exempt for goal-less personas (prompting "set a goal" is fine)', () => {
    expect(r(noGoal, loadRead('bad-goal-denial'), 'R6_no_goal_denial')?.passed).toBe(true)
  })
  it('R7 fails on a leaked (System note: …)', () => {
    expect(r(noGoal, loadRead('bad-system-note'), 'R7_no_system_note')?.passed).toBe(false)
  })
})
