import { describe, it, expect } from 'vitest'
import { formatMoney, moneySymbol, sanitizeMoneyInput, parseMoneyInput } from './money'

describe('sanitizeMoneyInput', () => {
  it('strips leading zeros but keeps a single zero', () => {
    expect(sanitizeMoneyInput('05200')).toBe('5200')
    expect(sanitizeMoneyInput('00123')).toBe('123')
    expect(sanitizeMoneyInput('0')).toBe('0')
    expect(sanitizeMoneyInput('')).toBe('')
  })

  it('strips thousands separators (commas/spaces) — the 5200 case', () => {
    expect(sanitizeMoneyInput('5,200')).toBe('5200')
    expect(sanitizeMoneyInput('5 200')).toBe('5200')
    expect(sanitizeMoneyInput('$5,200')).toBe('5200')
  })

  it('keeps only the first decimal point (no "5.200" → 5.2 corruption path)', () => {
    // A user typing what they mean as 5,200 with a dot separator no longer
    // collapses to 5.2 — only digits survive once separators are removed.
    expect(sanitizeMoneyInput('5.2.0')).toBe('5.20')
    expect(sanitizeMoneyInput('12.34')).toBe('12.34')
  })

  it('normalises a bare leading dot', () => {
    expect(sanitizeMoneyInput('.5')).toBe('0.5')
  })
})

describe('parseMoneyInput', () => {
  it('parses sanitised values to numbers', () => {
    expect(parseMoneyInput('5,200')).toBe(5200)
    expect(parseMoneyInput('05200')).toBe(5200)
    expect(parseMoneyInput('950')).toBe(950)
    expect(parseMoneyInput('12.34')).toBe(12.34)
  })

  it('returns null for empty or non-numeric input', () => {
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('.')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
  })
})

describe('moneySymbol', () => {
  it('returns symbol for known currencies', () => {
    expect(moneySymbol('EUR')).toBe('€')
    expect(moneySymbol('GBP')).toBe('£')
    expect(moneySymbol('USD')).toBe('$')
  })

  it('is case-insensitive', () => {
    expect(moneySymbol('eur')).toBe('€')
    expect(moneySymbol('gbp')).toBe('£')
  })

  it('falls back to code + space for unknown currencies', () => {
    expect(moneySymbol('JPY')).toBe('JPY ')
    expect(moneySymbol('XYZ')).toBe('XYZ ')
  })
})

describe('formatMoney — rounded (default)', () => {
  it('renders EUR with no decimals', () => {
    expect(formatMoney(1234.56, { currency: 'EUR' })).toBe('€1,235')
  })

  it('renders GBP with no decimals', () => {
    expect(formatMoney(1234.56, { currency: 'GBP' })).toBe('£1,235')
  })

  it('renders USD with no decimals', () => {
    expect(formatMoney(1234, { currency: 'USD' })).toBe('$1,234')
  })

  it('zero renders as symbol + 0', () => {
    expect(formatMoney(0, { currency: 'EUR' })).toBe('€0')
  })

  it('falls back to code + space for unknown currencies', () => {
    expect(formatMoney(1234, { currency: 'JPY' })).toBe('JPY 1,234')
  })
})

describe('formatMoney — precise', () => {
  it('renders 2 decimals', () => {
    expect(formatMoney(1234.5, { currency: 'EUR', format: 'precise' })).toBe('€1,234.50')
  })

  it('integer still renders 2 decimals', () => {
    expect(formatMoney(1234, { currency: 'EUR', format: 'precise' })).toBe('€1,234.00')
  })
})

describe('formatMoney — natural', () => {
  it('integer renders 0 decimals', () => {
    expect(formatMoney(1234, { currency: 'EUR', format: 'natural' })).toBe('€1,234')
  })

  it('fractional renders 2 decimals', () => {
    expect(formatMoney(1234.5, { currency: 'EUR', format: 'natural' })).toBe('€1,234.50')
  })
})

describe('formatMoney — sign handling', () => {
  it('negative uses Unicode minus before symbol', () => {
    expect(formatMoney(-50, { currency: 'EUR' })).toBe('−€50')
  })

  it('signed positive prepends + before symbol', () => {
    expect(formatMoney(50, { currency: 'EUR', signed: true })).toBe('+€50')
  })

  it('signed false (default) leaves positives unsigned', () => {
    expect(formatMoney(50, { currency: 'EUR' })).toBe('€50')
  })

  it('signed with zero does not add +', () => {
    expect(formatMoney(0, { currency: 'EUR', signed: true })).toBe('€0')
  })
})
