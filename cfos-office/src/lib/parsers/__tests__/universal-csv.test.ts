import { describe, it, expect } from 'vitest'
import { parseUniversalCSV, parseAmount, parseDate } from '../universal-csv'
import type { FormatTemplate } from '../types'

const SIGNED_TEMPLATE: FormatTemplate = {
  headerHash: 'h',
  bankName: 'Test Bank',
  fileType: 'csv',
  columnMapping: { date: 'Date', description: 'Description', amount: 'Amount' },
  signConvention: 'signed_single_column',
  dateFormat: 'YYYY-MM-DD',
  decimalFormat: 'dot',
  currencyDefault: 'GBP',
  sampleHeaders: 'Date,Description,Amount',
  detectionSource: 'llm',
}

const SPLIT_TEMPLATE: FormatTemplate = {
  headerHash: 'h',
  bankName: 'Monzo-like',
  fileType: 'csv',
  columnMapping: {
    date: 'Date',
    description: 'Name',
    credit: 'Money In',
    debit: 'Money Out',
  },
  signConvention: 'split_in_out',
  dateFormat: 'DD/MM/YYYY',
  decimalFormat: 'dot',
  currencyDefault: 'GBP',
  sampleHeaders: 'Date,Name,Money In,Money Out',
  detectionSource: 'llm',
}

const TYPE_FLAG_TEMPLATE: FormatTemplate = {
  headerHash: 'h',
  bankName: 'DR/CR bank',
  fileType: 'csv',
  columnMapping: {
    date: 'Date',
    description: 'Desc',
    amount: 'Amount',
    type_flag: 'Type',
    type_flag_values: { debit: 'DR', credit: 'CR' },
  },
  signConvention: 'type_flag',
  dateFormat: 'DD/MM/YYYY',
  decimalFormat: 'dot',
  currencyDefault: 'GBP',
  sampleHeaders: 'Date,Desc,Amount,Type',
  detectionSource: 'llm',
}

// ── sign convention ───────────────────────────────────────────────

describe('parseUniversalCSV — sign convention', () => {
  it('signed_single_column: preserves negative debit as-is', () => {
    const csv = 'Date,Description,Amount\n2026-01-15,Tesco,-42.00'
    const r = parseUniversalCSV(csv, SIGNED_TEMPLATE)
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions[0].amount).toBe(-42)
  })

  it('signed_single_column: credit stays positive', () => {
    const csv = 'Date,Description,Amount\n2026-01-15,Salary,2500'
    const r = parseUniversalCSV(csv, SIGNED_TEMPLATE)
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions[0].amount).toBe(2500)
  })

  it('split_in_out: £42 debit (Money Out only) becomes -42', () => {
    const csv = 'Date,Name,Money In,Money Out\n15/01/2026,Tesco,,42.00'
    const r = parseUniversalCSV(csv, SPLIT_TEMPLATE)
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions[0].amount).toBe(-42)
  })

  it('split_in_out: £100 credit (Money In only) stays +100', () => {
    const csv = 'Date,Name,Money In,Money Out\n15/01/2026,Refund,100,'
    const r = parseUniversalCSV(csv, SPLIT_TEMPLATE)
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions[0].amount).toBe(100)
  })

  it('type_flag: DR flag flips positive 42 to -42', () => {
    const csv = 'Date,Desc,Amount,Type\n15/01/2026,Tesco,42.00,DR'
    const r = parseUniversalCSV(csv, TYPE_FLAG_TEMPLATE)
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions[0].amount).toBe(-42)
  })

  it('type_flag: CR flag keeps positive 42 as +42', () => {
    const csv = 'Date,Desc,Amount,Type\n15/01/2026,Refund,42.00,CR'
    const r = parseUniversalCSV(csv, TYPE_FLAG_TEMPLATE)
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions[0].amount).toBe(42)
  })
})

// ── decimal formats ───────────────────────────────────────────────

describe('parseAmount', () => {
  it('handles dot decimals with thousands commas', () => {
    expect(parseAmount('1,234.56', 'dot')).toBe(1234.56)
    expect(parseAmount('-42.00', 'dot')).toBe(-42)
    expect(parseAmount('£42.00', 'dot')).toBe(42)
  })

  it('handles comma decimals with thousands dots', () => {
    expect(parseAmount('1.234,56', 'comma')).toBe(1234.56)
    expect(parseAmount('-42,00', 'comma')).toBe(-42)
  })

  it('returns null on empty input', () => {
    expect(parseAmount('', 'dot')).toBeNull()
    expect(parseAmount('   ', 'dot')).toBeNull()
  })

  it('returns null on garbage', () => {
    expect(parseAmount('n/a', 'dot')).toBeNull()
  })
})

// ── date parsing ──────────────────────────────────────────────────

describe('parseDate', () => {
  it('parses ISO dates', () => {
    expect(parseDate('2026-01-15', 'ISO')).toBe('2026-01-15T00:00:00Z')
    expect(parseDate('2026-01-15T14:23:00Z', 'ISO')).toBe('2026-01-15T14:23:00Z')
  })

  it('parses UK DD/MM/YYYY dates', () => {
    expect(parseDate('15/01/2026', 'DD/MM/YYYY')).toBe('2026-01-15T00:00:00Z')
    expect(parseDate('1/2/2026', 'DD/MM/YYYY')).toBe('2026-02-01T00:00:00Z')
  })

  it('parses US MM/DD/YYYY dates', () => {
    expect(parseDate('01/15/2026', 'MM/DD/YYYY')).toBe('2026-01-15T00:00:00Z')
  })

  it('returns empty string on unparseable input', () => {
    expect(parseDate('garbage', 'DD/MM/YYYY')).toBe('')
  })
})

// ── warnings and skipping ─────────────────────────────────────────

describe('parseUniversalCSV — resilience', () => {
  it('skips rows with unparseable dates and reports a warning', () => {
    const csv = 'Date,Description,Amount\n2026-01-15,Ok,1\nbad,Nope,2'
    const r = parseUniversalCSV(csv, SIGNED_TEMPLATE)
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions).toHaveLength(1)
    expect(r.skippedRows).toBe(1)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('returns ok=false when every row is unparseable', () => {
    const csv = 'Date,Description,Amount\nbad,Nope,oops'
    const r = parseUniversalCSV(csv, SIGNED_TEMPLATE)
    expect(r.ok).toBe(false)
  })
})
