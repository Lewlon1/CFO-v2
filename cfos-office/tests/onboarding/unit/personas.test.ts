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
    if (true) {
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
  }
})
