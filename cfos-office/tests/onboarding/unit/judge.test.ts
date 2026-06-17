import { describe, it, expect } from 'vitest'
import { readContent, evaluateHardRules } from '../runner/judge'
import { summariseCsv } from '../runner/csv-summariser'
import { builderClassic } from '../personas/builder-classic'
import { zaneSpain } from '../personas/zane-spain'
import { anchorDebt } from '../personas/anchor-debt'
import { loadRead, listReads } from '../fixtures'
import { getPersona } from '../personas'
import type { ReadKind } from '../runner/types'

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
    const read = 'Your free cash is £1,750 a month.\n\n[CTA:start_statement_check]Check[/CTA]\n\n— C.'
    const rules = evaluateHardRules(builderClassic, 'estimate_read', read, null)
    const h1 = rules.find((r) => r.ruleId === 'H1_signoff_present')
    expect(h1?.passed).toBe(true)
  })

  it('H1_signoff_present passes when judged via the wrapper object (the original bug)', () => {
    const wrapper = {
      conversationType: 'first_read',
      content: 'Your free cash is £1,750.\n\n[CTA:start_statement_check]Check[/CTA]\n\n— C.',
      messageId: 'abc',
    }
    const content = readContent(wrapper)
    const rules = evaluateHardRules(builderClassic, 'estimate_read', content, null)
    expect(rules.find((r) => r.ruleId === 'H1_signoff_present')?.passed).toBe(true)
  })
})

// Multi-month so spendingTotal (4000) exceeds the computed monthly facts the
// reality-check Read legitimately quotes (fixed costs, FCF) — those must NOT be
// flagged. R4 runs with a CSV on the reality-check Read (post-upload).
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
    evaluateHardRules(builderClassic, 'reality_check_read', read, csv).find((r) => r.ruleId === 'R4_numbers_match_csv')

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

  it('estimate Read is judged WITHOUT a CSV, so R4 is a no-op', () => {
    // The estimate Read predates any upload; the runner passes csvSummary=null.
    const r = evaluateHardRules(builderClassic, 'estimate_read', 'Your goal needs ≈£830 a month.\n\n— C.', null).find(
      (x) => x.ruleId === 'R4_numbers_match_csv',
    )
    expect(r?.passed).toBe(true)
  })
})

describe('fixtures', () => {
  it('loads the captured corpus', () => {
    // Hand-authored golden estimate/reality Reads + the 7 bad-* judge fixtures.
    expect(listReads().length).toBeGreaterThanOrEqual(10)
    expect(loadRead('zane-spain.captured')).toMatch(/— C\.\s*$/)
  })
})

describe('R5 currency symbol', () => {
  const r5 = (persona: typeof builderClassic, read: string, kind: ReadKind = 'estimate_read') =>
    evaluateHardRules(persona, kind, read, null).find((r) => r.ruleId === 'R5_currency_symbol')

  it('fails a GBP persona whose Read uses €', () => {
    // bad-euro-on-gbp fixture is an intentionally wrong-currency Read
    expect(r5(builderClassic, loadRead('bad-euro-on-gbp'))?.passed).toBe(false)
  })
  it('passes a GBP persona whose Read uses £', () => {
    expect(r5(builderClassic, loadRead('builder-classic.captured'))?.passed).toBe(true)
  })
  it('passes a EUR persona whose Read uses €', () => {
    expect(r5(zaneSpain, loadRead('zane-spain.captured'))?.passed).toBe(true)
  })
})

describe('R6 goal-denial / R7 system-note', () => {
  // Every estimates-first persona has a goal (the goal beat creates one), so R6
  // is a universal check — no goal-less exemption anymore.
  const r = (read: string, id: string) =>
    evaluateHardRules(builderClassic, 'estimate_read', read, null).find((x) => x.ruleId === id)

  it('R6 fails when a Read denies the goal', () => {
    expect(r(loadRead('bad-goal-denial'), 'R6_no_goal_denial')?.passed).toBe(false)
  })
  it('R6 passes a clean Read', () => {
    const read = 'Your free cash is £600 a month.\n\n[CTA:start_statement_check]Check[/CTA]\n\n— C.'
    expect(r(read, 'R6_no_goal_denial')?.passed).toBe(true)
  })
  it('R7 fails on a leaked (System note: …)', () => {
    expect(r(loadRead('bad-system-note'), 'R7_no_system_note')?.passed).toBe(false)
  })
})

describe('R8 CTA vocabulary', () => {
  const r8 = (read: string) =>
    evaluateHardRules(builderClassic, 'estimate_read', read, null).find((r) => r.ruleId === 'R8_cta_vocabulary')

  it('R8 passes the estimate-Read close (start_statement_check)', () => {
    const read = 'Body.\n\n[CTA:start_statement_check]Check my numbers[/CTA]\n\n— C.'
    expect(r8(read)?.passed).toBe(true)
  })
  it('R8 passes the reality-check close (start_value_map_real)', () => {
    const read = 'Body.\n\n[CTA:start_value_map_real]Value-map these[/CTA]\n\n— C.'
    expect(r8(read)?.passed).toBe(true)
  })
  it('R8 fails an unknown CTA type', () => {
    const read = 'Body.\n\n[CTA:teleport]Go[/CTA]\n\n— C.'
    expect(r8(read)?.passed).toBe(false)
  })
})

describe('R8b CTA matches the Read type', () => {
  const r8b = (kind: ReadKind, read: string) =>
    evaluateHardRules(builderClassic, kind, read, null).find((r) => r.ruleId === 'R8b_cta_matches_read')

  it('estimate_read requires start_statement_check', () => {
    expect(r8b('estimate_read', 'Body.\n\n[CTA:start_statement_check]Check[/CTA]\n\n— C.')?.passed).toBe(true)
    expect(r8b('estimate_read', 'Body.\n\n[CTA:start_value_map_real]VM[/CTA]\n\n— C.')?.passed).toBe(false)
  })
  it('reality_check_read requires start_value_map_real', () => {
    expect(r8b('reality_check_read', 'Body.\n\n[CTA:start_value_map_real]VM[/CTA]\n\n— C.')?.passed).toBe(true)
    expect(r8b('reality_check_read', 'Body.\n\n[CTA:start_statement_check]Check[/CTA]\n\n— C.')?.passed).toBe(false)
  })

  it('H8_cites_known_merchant never fires (merchant-citation requirement dropped)', () => {
    // checkReadHardRules is called without knownMerchants — H8 is never triggered.
    const rules = evaluateHardRules(builderClassic, 'estimate_read', loadRead('builder-classic.captured'), null)
    expect(rules.find((r) => r.ruleId === 'H8_cites_known_merchant')).toBeUndefined()
  })
})

describe('R1c estimate-only banned patterns', () => {
  // anchor-debt scopes behavioural / willpower bans to the estimate Read only: with
  // no transactions a "discipline" claim is unfounded, but the reality-check Read may
  // legitimately cite it once the statement backs it. The both-Reads bannedPatterns
  // ("just need to" lecturing) still apply to BOTH.
  const find = (kind: ReadKind, read: string, ruleId: string) =>
    evaluateHardRules(anchorDebt, kind, read, null).find((r) => r.ruleId === ruleId)

  it('fails R1c on the estimate Read for a behavioural pattern', () => {
    const read = 'You simply need a plan.\n\n[CTA:start_statement_check]Check[/CTA]\n\n— C.'
    expect(find('estimate_read', read, 'R1c_no_estimate_only_patterns')?.passed).toBe(false)
  })

  it('does NOT apply R1c to the reality-check Read', () => {
    const read = 'The discipline is already there — the margin proves it.\n\n[CTA:start_value_map_real]VM[/CTA]\n\n— C.'
    expect(find('reality_check_read', read, 'R1c_no_estimate_only_patterns')).toBeUndefined()
  })

  it('still enforces both-Read bannedPatterns on the reality-check Read', () => {
    const read = 'You just need to cut back.\n\n[CTA:start_value_map_real]VM[/CTA]\n\n— C.'
    expect(find('reality_check_read', read, 'R1b_no_banned_patterns')?.passed).toBe(false)
  })
})

// ── Golden corpus ───────────────────────────────────────────────────────────
// Decoupled from the persona list: validate whatever *.captured fixtures are
// committed. `<id>.captured` is an estimate Read; `<id>.reality.captured` is a
// reality-check Read. The staging suite re-captures these against the live flow;
// hand-authored golden Reads stand in so CI is deterministic without a run.

function csvFor(personaId: string) {
  const p = getPersona(personaId)
  return p?.csv ? summariseCsv(Buffer.from(p.csv.contentBase64, 'base64').toString('utf-8'), p.profile.currency) : null
}

describe('golden corpus — captured Reads pass every rule', () => {
  const captured = listReads().filter((n) => n.endsWith('.captured'))

  it('has captured fixtures to validate', () => {
    expect(captured.length).toBeGreaterThan(0)
  })

  for (const name of captured) {
    const isReality = name.endsWith('.reality.captured')
    const personaId = name.replace(/\.(reality\.)?captured$/, '')
    const kind: ReadKind = isReality ? 'reality_check_read' : 'estimate_read'

    it(`${name}: all hard rules pass`, () => {
      const persona = getPersona(personaId)
      expect(persona, `no persona registered for fixture "${name}"`).toBeDefined()
      // The estimate Read is judged without a CSV; the reality-check Read against it.
      const csv = isReality ? csvFor(personaId) : null
      const rules = evaluateHardRules(persona!, kind, loadRead(name), csv)
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
      const rules = evaluateHardRules(builderClassic, 'estimate_read', loadRead(fixture), null)
      expect(rules.find((r) => r.ruleId === ruleId)?.passed).toBe(false)
    })
  }
})
