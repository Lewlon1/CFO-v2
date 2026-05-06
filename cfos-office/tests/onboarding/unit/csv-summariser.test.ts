import { describe, it, expect } from 'vitest'
import { summariseCsv } from '../runner/csv-summariser'

describe('summariseCsv', () => {
  const csv = [
    'Type,Started Date,Description,Amount,Currency,Balance',
    'TRANSFER,2026-01-28,Salary Acme Ltd,3200.00,GBP,3200.00',
    'CARD_PAYMENT,2026-01-01,Rent,-1100.00,GBP,2100.00',
    'CARD_PAYMENT,2026-01-05,Tesco,-60.00,GBP,2040.00',
    'CARD_PAYMENT,2026-01-12,Tesco,-55.00,GBP,1985.00',
    'CARD_PAYMENT,2026-01-15,Netflix,-14.99,GBP,1970.01',
    'CARD_PAYMENT,2026-01-18,Vanguard ISA,-500.00,GBP,1470.01',
  ].join('\n')

  it('extracts a structured summary', () => {
    const summary = summariseCsv(csv, 'GBP')
    expect(summary.transactionCount).toBe(6)
    expect(summary.dateRange.from).toBe('2026-01-01')
    expect(summary.dateRange.to).toBe('2026-01-28')
    expect(summary.incomeTotal).toBeCloseTo(3200)
    expect(summary.spendingTotal).toBeCloseTo(1729.99)
    expect(summary.topMerchants.length).toBeGreaterThan(0)
    expect(summary.topMerchants[0].description.toLowerCase()).toContain('rent')
  })

  it('groups duplicate merchants', () => {
    const summary = summariseCsv(csv, 'GBP')
    const tesco = summary.topMerchants.find((m) => m.description === 'Tesco')
    expect(tesco).toBeDefined()
    expect(tesco?.count).toBe(2)
  })

  it('formats summary as text block for judge prompt', () => {
    const summary = summariseCsv(csv, 'GBP')
    const text = summary.asText()
    expect(text).toContain('6 transactions')
    expect(text).toContain('Rent')
    expect(text).toContain('Tesco')
  })
})
