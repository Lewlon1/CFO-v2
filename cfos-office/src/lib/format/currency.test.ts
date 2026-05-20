import { describe, expect, it } from 'vitest'
import { formatCurrency } from './currency'

describe('formatCurrency', () => {
  it('formats whole EUR by default', () => {
    expect(formatCurrency(1234)).toBe('€1,234')
  })

  it('uses absolute value for negative amounts', () => {
    expect(formatCurrency(-1234)).toBe('€1,234')
  })

  it('renders symbol for GBP', () => {
    expect(formatCurrency(1234, 'GBP')).toBe('£1,234')
  })

  it('renders symbol for USD', () => {
    expect(formatCurrency(1234, 'USD')).toBe('$1,234')
  })

  it('falls back to code + space for unknown currencies', () => {
    expect(formatCurrency(1234, 'JPY')).toBe('JPY 1,234')
  })

  it('returns em-dash for null', () => {
    expect(formatCurrency(null)).toBe('—')
  })

  it('returns em-dash for undefined', () => {
    expect(formatCurrency(undefined)).toBe('—')
  })

  it('renders 2 decimals when requested', () => {
    expect(formatCurrency(1234.56, 'EUR', { decimals: 2 })).toBe('€1,234.56')
  })

  it('rounds when requested decimals are lower than the input precision', () => {
    expect(formatCurrency(1234.56, 'EUR', { decimals: 0 })).toBe('€1,235')
  })

  it('respects locale for thousands separators (en-GB matches en for these numbers)', () => {
    expect(formatCurrency(1234567, 'EUR', { locale: 'en-GB' })).toBe('€1,234,567')
  })

  it('treats null currency as EUR', () => {
    expect(formatCurrency(50, null)).toBe('€50')
  })

  it('treats empty-string currency as EUR', () => {
    expect(formatCurrency(50, '')).toBe('€50')
  })

  it('zero renders as the symbol + 0', () => {
    expect(formatCurrency(0)).toBe('€0')
  })
})
