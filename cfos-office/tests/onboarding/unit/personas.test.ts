import { describe, it, expect } from 'vitest'
import { PERSONAS } from '../personas'
import { summariseCsv } from '../runner/csv-summariser'
import { USER_DATA_TABLES_BY_USER_ID } from '../runner/user-factory'
import { TOP_VALUES, type AgeBand } from '../personas/types'
import { DOOR_FAMILIES, struggleToFamily, type DoorFamily } from '@/lib/onboarding-v2/door/door-config'
import { RELATE_OPTIONS } from '@/lib/onboarding-v2/composite/composite-config'
import { DEADLINE_OPTIONS } from '@/lib/onboarding-v2/goal-config'
import {
  HOUSING_BANDS,
  SUBS_BANDS,
  BILLS_BANDS,
  FOOD_OUT_BANDS,
  SAVE_REACH_BANDS,
} from '@/lib/onboarding-v2/estimates/bands'

// PERSONAS is the exported array from personas/index.ts — iterate it directly.
const ALL = PERSONAS

const AGE_BANDS: AgeBand[] = ['18-29', '30-39', '40-49', '50+']
const VERDICT_VALUES = ['worth_it', 'leak', 'unsure'] as const

/** Effective door family for a persona: explicit override, else the legacy
 *  struggle reverse-map (every persona resolves to one of the four families). */
function familyOf(p: (typeof ALL)[number]): DoorFamily {
  return p.expectations.doorFamily ?? struggleToFamily(p.expectations.entryStruggle) ?? 'growth'
}

describe('persona income/rent realism', () => {
  for (const p of ALL) {
    it(`${p.id}: monthlyIncome and monthlyRent are set`, () => {
      expect(typeof p.profile.monthlyIncome).toBe('number')
      expect(typeof p.profile.monthlyRent).toBe('number')
    })
    it(`${p.id}: monthlyIncome within 25% of CSV-derived monthly income`, () => {
      if (!p.csv) return // non-check personas never upload — no CSV to compare against
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

describe('estimates-first beat picks are valid + well-spread', () => {
  for (const p of ALL) {
    const e = p.expectations
    it(`${p.id}: country is a composite country (GB|ES)`, () => {
      expect(['GB', 'ES']).toContain(p.profile.country)
    })
    it(`${p.id}: ageBand is one of the four context bands`, () => {
      expect(AGE_BANDS).toContain(e.ageBand)
    })
    it(`${p.id}: compositeRelate is a valid relate option`, () => {
      expect(RELATE_OPTIONS.map((o) => o.id)).toContain(e.compositeRelate)
    })
    it(`${p.id}: a not_me relate carries a valid repick family that differs from the door family`, () => {
      if (e.compositeRelate === 'not_me') {
        expect(e.compositeRepickFamily).toBeDefined()
        expect(DOOR_FAMILIES).toContain(e.compositeRepickFamily!)
        // The repick chips render DOOR_FAMILIES.filter(f => f !== doorFamily), so a
        // repick equal to the door family would target a chip that never renders.
        expect(e.compositeRepickFamily).not.toBe(familyOf(p))
      }
    })
    it(`${p.id}: goalDeadline is a valid deadline id`, () => {
      expect(DEADLINE_OPTIONS.map((d) => d.id)).toContain(e.goalDeadline)
    })
    it(`${p.id}: the five sketch bands are valid band ids`, () => {
      expect(Object.keys(HOUSING_BANDS)).toContain(e.sketchBands.housing)
      expect(Object.keys(SUBS_BANDS)).toContain(e.sketchBands.subs)
      expect(Object.keys(BILLS_BANDS)).toContain(e.sketchBands.bills)
      expect(Object.keys(FOOD_OUT_BANDS)).toContain(e.sketchBands.foodOut)
      expect(Object.keys(SAVE_REACH_BANDS)).toContain(e.sketchBands.saveReach)
    })
    it(`${p.id}: topValue is a valid chip`, () => {
      expect(TOP_VALUES).toContain(e.topValue)
    })
    it(`${p.id}: the three verdicts are valid`, () => {
      expect(VERDICT_VALUES).toContain(e.verdicts.subscriptions)
      expect(VERDICT_VALUES).toContain(e.verdicts.foodOut)
      expect(VERDICT_VALUES).toContain(e.verdicts.drift)
    })
  }

  it('all four door families are represented across the personas', () => {
    const families = new Set(ALL.map(familyOf))
    for (const f of DOOR_FAMILIES) expect(families).toContain(f)
  })

  it('all four deadline options are represented across the personas', () => {
    const deadlines = new Set(ALL.map((p) => p.expectations.goalDeadline))
    for (const d of DEADLINE_OPTIONS) expect(deadlines).toContain(d.id)
  })
})

describe('statement-check coverage', () => {
  const checkPersonas = ALL.filter((p) => p.expectations.runStatementCheck)

  it('at least two personas run the statement-check leg', () => {
    expect(checkPersonas.length).toBeGreaterThanOrEqual(2)
  })

  for (const p of checkPersonas) {
    it(`${p.id}: a statement-check persona carries a CSV to upload`, () => {
      expect(p.csv).not.toBeNull()
      expect(p.csv!.contentBase64.length).toBeGreaterThan(0)
    })
    it(`${p.id}: stagesCompleted includes the reality_check terminal`, () => {
      expect(p.expectations.stagesCompleted).toContain('reality_check')
    })
  }

  for (const p of ALL.filter((x) => !x.expectations.runStatementCheck)) {
    it(`${p.id}: a non-check persona stops at the estimate_read terminal`, () => {
      expect(p.expectations.stagesCompleted).toContain('estimate_read')
      expect(p.expectations.stagesCompleted).not.toContain('reality_check')
    })
  }
})

describe('teardown coverage', () => {
  it('includes llm_usage_log (prevents orphan accumulation)', () => {
    expect(USER_DATA_TABLES_BY_USER_ID).toContain('llm_usage_log')
  })
})
