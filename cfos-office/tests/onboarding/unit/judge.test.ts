import { describe, it, expect } from 'vitest'
import { readContent, evaluateHardRules } from '../runner/judge'
import { summariseCsv } from '../runner/csv-summariser'
import { builderClassic } from '../personas/builder-classic'
import { zaneSpain } from '../personas/zane-spain'
import { loadRead, listReads } from '../fixtures'
import { PERSONAS } from '../personas'

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

  const INCOME_HEAVY_CSV = [
    'Type,Started Date,Description,Amount,Currency,Balance',
    'TRANSFER,2026-01-30,Salary,3100.00,GBP,0',
    'CARD_PAYMENT,2026-01-01,Rent,-1000.00,GBP,0',
    'CARD_PAYMENT,2026-01-05,Tesco,-300.00,GBP,0',
    'CARD_PAYMENT,2026-01-10,Sundries,-254.00,GBP,0',
  ].join('\n') // incomeTotal 3100, spendingTotal 1554
  it('does not flag declared income / FCF above total spend but below the income-aware floor', () => {
    const c = summariseCsv(INCOME_HEAVY_CSV, 'GBP')
    const r = evaluateHardRules(builderClassic, 'insight', 'Net income £3,000; free cash flow £2,000 a month.\n\n— C.', c)
    expect(r.find((x) => x.ruleId === 'R4_numbers_match_csv')?.passed).toBe(true)
  })
  it('still flags a genuinely egregious figure on an income-heavy CSV', () => {
    const c = summariseCsv(INCOME_HEAVY_CSV, 'GBP')
    const r = evaluateHardRules(builderClassic, 'insight', 'Portfolio holds £250,000.\n\n— C.', c)
    expect(r.find((x) => x.ruleId === 'R4_numbers_match_csv')?.passed).toBe(false)
  })
})

describe('fixtures', () => {
  it('loads the captured corpus', () => {
    expect(listReads().length).toBeGreaterThanOrEqual(17) // 10 captured + 7 bad (gbp files deleted; loose lower bound)
    expect(loadRead('zane-spain.captured')).toMatch(/— C\.\s*$/)
  })
})

describe('R5 currency symbol', () => {
  const r5 = (persona: typeof builderClassic, read: string) =>
    evaluateHardRules(persona, 'insight', read, null).find((r) => r.ruleId === 'R5_currency_symbol')

  it('fails a GBP persona whose Read uses €', () => {
    // bad-euro-on-gbp fixture is an intentionally wrong-currency Read
    expect(r5(builderClassic, loadRead('bad-euro-on-gbp'))?.passed).toBe(false)
  })
  it('passes a GBP persona whose Read uses £', () => {
    // builder-classic.captured is the real live-run GBP Read (post corpus refresh)
    expect(r5(builderClassic, loadRead('builder-classic.captured'))?.passed).toBe(true)
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

describe('R8 CTA vocabulary', () => {
  it('R8 passes a known CTA type (set_goal)', () => {
    const read = 'Body.\n\n[CTA:set_goal]Set a goal[/CTA]\n\n— C.'
    expect(evaluateHardRules(builderClassic, 'insight', read, null).find((r) => r.ruleId === 'R8_cta_vocabulary')?.passed).toBe(true)
  })
  it('R8 passes the cut_lever CTA type (live goal-aware Reads)', () => {
    const read = 'Body.\n\n[CTA:cut_lever]Trim £25 from subscriptions[/CTA]\n\n— C.'
    expect(evaluateHardRules(builderClassic, 'insight', read, null).find((r) => r.ruleId === 'R8_cta_vocabulary')?.passed).toBe(true)
  })
  it('R8 fails an unknown CTA type', () => {
    const read = 'Body.\n\n[CTA:teleport]Go[/CTA]\n\n— C.'
    expect(evaluateHardRules(builderClassic, 'insight', read, null).find((r) => r.ruleId === 'R8_cta_vocabulary')?.passed).toBe(false)
  })
  it('H8_cites_known_merchant never fires (merchant-citation requirement dropped)', () => {
    // checkReadHardRules is now called without knownMerchants — H8 is never triggered from the test.
    const aikoCsv = summariseCsv('Type,Started Date,Description,Amount,Currency,Balance\nCARD_PAYMENT,2026-01-01,Tesco,-10,GBP,0', 'GBP')
    const rules = evaluateHardRules(builderClassic, 'insight', loadRead('aiko-low-transaction.captured'), aikoCsv)
    expect(rules.find((r) => r.ruleId === 'H8_cites_known_merchant')).toBeUndefined()
  })
})

// NOTE: personas/index.ts exports the PERSONAS array (no individual named
// exports), so iterate it directly. Do NOT use `import * as personas` +
// Object.values().filter(p=>p.id) — that matches nothing and the loop would
// vacuously pass.
function csvFor(p: (typeof PERSONAS)[number]) {
  return p.csv ? summariseCsv(Buffer.from(p.csv.contentBase64, 'base64').toString('utf-8'), p.profile.currency) : null
}

describe('golden corpus — good Reads pass every rule', () => {
  for (const p of PERSONAS) {
    // All fixtures are now the real live-run Reads (Task 14 corpus refresh).
    // Goal-aware Reads correctly reference their seeded goal, so R6 and R9 are
    // evaluated against the full persona (goal-strip removed).
    it(`${p.id}: all hard rules pass on the good Read`, () => {
      const rules = evaluateHardRules(p, 'insight', loadRead(`${p.id}.captured`), csvFor(p))
      const failed = rules.filter((r) => !r.passed)
      expect(failed.map((f) => `${f.ruleId}:${f.detail ?? ''}`)).toEqual([])
    })
  }
})

describe('golden corpus — bad Reads fail the intended rule', () => {
  const cases: [string, string][] = [
    ['bad-missing-signoff', 'H1_signoff_present'],
    ['bad-options-block', 'H4_no_options_block'],
    ['bad-question-close', 'H5_no_question_close'],
    ['bad-euro-on-gbp', 'R5_currency_symbol'],
  ]
  for (const [fixture, ruleId] of cases) {
    it(`${fixture} → ${ruleId} fails`, () => {
      const rules = evaluateHardRules(builderClassic, 'insight', loadRead(fixture), null)
      expect(rules.find((r) => r.ruleId === ruleId)?.passed).toBe(false)
    })
  }
})
