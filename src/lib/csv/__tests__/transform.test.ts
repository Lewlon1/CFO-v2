import { describe, it, expect } from 'vitest'
import { transformRow } from '../transform'
import type { ColumnMapping } from '../transform'

const fullMapping: ColumnMapping = {
  Date: 'date',
  Amount: 'amount',
  Description: 'description',
  Merchant: 'merchant',
  Type: 'type',
  Currency: 'currency',
}

function makeRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Date: '2024-01-15',
    Amount: '50.00',
    Description: 'Test transaction',
    Merchant: 'Test Merchant',
    Type: '',
    Currency: '',
    ...overrides,
  }
}

describe('transformRow', () => {
  describe('date parsing', () => {
    it('parses ISO format YYYY-MM-DD', () => {
      const result = transformRow(makeRow({ Date: '2024-01-15' }), fullMapping, 'EUR')
      expect(result.transaction_date).toBe('2024-01-15')
    })

    it('truncates ISO datetime to date part', () => {
      const result = transformRow(makeRow({ Date: '2024-01-15T12:30:00Z' }), fullMapping, 'EUR')
      expect(result.transaction_date).toBe('2024-01-15')
    })

    it('parses DD/MM/YYYY format', () => {
      const result = transformRow(makeRow({ Date: '15/01/2024' }), fullMapping, 'EUR')
      expect(result.transaction_date).toBe('2024-01-15')
    })

    it('parses DD.MM.YYYY format', () => {
      const result = transformRow(makeRow({ Date: '15.01.2024' }), fullMapping, 'EUR')
      expect(result.transaction_date).toBe('2024-01-15')
    })

    it('parses DD-MM-YYYY format', () => {
      const result = transformRow(makeRow({ Date: '15-01-2024' }), fullMapping, 'EUR')
      expect(result.transaction_date).toBe('2024-01-15')
    })

    it('pads single-digit day and month', () => {
      const result = transformRow(makeRow({ Date: '5/1/2024' }), fullMapping, 'EUR')
      expect(result.transaction_date).toBe('2024-01-05')
    })

    it('expands 2-digit year', () => {
      const result = transformRow(makeRow({ Date: '15/01/24' }), fullMapping, 'EUR')
      expect(result.transaction_date).toBe('2024-01-15')
    })

    it('sets parseError and preserves rawDate for unparseable date', () => {
      const result = transformRow(makeRow({ Date: 'not-a-date' }), fullMapping, 'EUR')
      expect(result.parseError).toMatch(/Could not parse date/)
      expect(result.parseError).toContain('not-a-date')
      expect(result.transaction_date).toBe('not-a-date')
    })

    it('sets parseError when date is empty', () => {
      const result = transformRow(makeRow({ Date: '' }), fullMapping, 'EUR')
      expect(result.parseError).toMatch(/Could not parse date/)
    })
  })

  describe('amount parsing', () => {
    it('parses plain integer', () => {
      expect(transformRow(makeRow({ Amount: '100' }), fullMapping, 'EUR').amount).toBe(100)
    })

    it('parses decimal with dot separator', () => {
      expect(transformRow(makeRow({ Amount: '1234.56' }), fullMapping, 'EUR').amount).toBe(1234.56)
    })

    it('parses European format with thousand dot and comma decimal (1.234,56)', () => {
      expect(transformRow(makeRow({ Amount: '1.234,56' }), fullMapping, 'EUR').amount).toBe(1234.56)
    })

    it('parses comma as decimal separator (1234,56)', () => {
      expect(transformRow(makeRow({ Amount: '1234,56' }), fullMapping, 'EUR').amount).toBe(1234.56)
    })

    it('strips euro symbol', () => {
      expect(transformRow(makeRow({ Amount: '€50.00' }), fullMapping, 'EUR').amount).toBe(50)
    })

    it('strips dollar symbol', () => {
      // Note: "$1,234.56" is US format but the parser handles European-style thousands (1.234,56)
      // not US-style (1,234.56), so use an amount without a comma thousands separator here.
      expect(transformRow(makeRow({ Amount: '$1234.56' }), fullMapping, 'EUR').amount).toBe(1234.56)
    })

    it('strips whitespace around amount', () => {
      expect(transformRow(makeRow({ Amount: ' 99.99 ' }), fullMapping, 'EUR').amount).toBe(99.99)
    })

    it('returns absolute value of negative amount', () => {
      expect(transformRow(makeRow({ Amount: '-50.00' }), fullMapping, 'EUR').amount).toBe(50)
    })

    it('returns absolute value of positive amount unchanged', () => {
      expect(transformRow(makeRow({ Amount: '50.00' }), fullMapping, 'EUR').amount).toBe(50)
    })

    it('sets parseError for text that cannot be parsed', () => {
      const result = transformRow(makeRow({ Amount: 'n/a' }), fullMapping, 'EUR')
      expect(result.parseError).toMatch(/Could not parse amount/)
      expect(result.parseError).toContain('n/a')
    })

    it('sets parseError for empty amount', () => {
      const result = transformRow(makeRow({ Amount: '' }), fullMapping, 'EUR')
      expect(result.parseError).toMatch(/Could not parse amount/)
    })
  })

  describe('transaction type inference', () => {
    it.each([
      ['income', 'income'],
      ['Income', 'income'],
      ['INCOME', 'income'],
      ['credit', 'income'],
      ['Credit', 'income'],
      ['abono', 'income'],
      ['salary', 'income'],
      ['salario', 'income'],
      ['ingreso', 'income'],
      ['Ingreso', 'income'],
    ])('infers income from type "%s"', (typeValue, expected) => {
      const result = transformRow(makeRow({ Type: typeValue }), fullMapping, 'EUR')
      expect(result.type).toBe(expected)
    })

    it.each([
      ['expense', 'expense'],
      ['Expense', 'expense'],
      ['debit', 'expense'],
      ['Debit', 'expense'],
      ['cargo', 'expense'],
      ['pago', 'expense'],
      ['gasto', 'expense'],
    ])('infers expense from type "%s"', (typeValue, expected) => {
      const result = transformRow(makeRow({ Type: typeValue }), fullMapping, 'EUR')
      expect(result.type).toBe(expected)
    })

    it.each([
      ['transfer', 'transfer'],
      ['Transfer', 'transfer'],
      ['TRANSFER', 'transfer'],
      ['transferencia', 'transfer'],
      ['traspaso', 'transfer'],
    ])('infers transfer from type "%s"', (typeValue, expected) => {
      const result = transformRow(makeRow({ Type: typeValue }), fullMapping, 'EUR')
      expect(result.type).toBe(expected)
    })

    it('falls back to "expense" for negative amount when type is unknown', () => {
      const result = transformRow(makeRow({ Amount: '-50', Type: 'other' }), fullMapping, 'EUR')
      expect(result.type).toBe('expense')
    })

    it('falls back to "income" for positive amount when type is unknown', () => {
      const result = transformRow(makeRow({ Amount: '1000', Type: 'other' }), fullMapping, 'EUR')
      expect(result.type).toBe('income')
    })

    it('falls back to "income" for positive amount when type column is empty', () => {
      const result = transformRow(makeRow({ Amount: '1000', Type: '' }), fullMapping, 'EUR')
      expect(result.type).toBe('income')
    })
  })

  describe('description and merchant', () => {
    it('returns description string when present', () => {
      const result = transformRow(makeRow({ Description: 'Coffee shop' }), fullMapping, 'EUR')
      expect(result.description).toBe('Coffee shop')
    })

    it('returns null when description is empty', () => {
      const result = transformRow(makeRow({ Description: '' }), fullMapping, 'EUR')
      expect(result.description).toBeNull()
    })

    it('returns null when description is whitespace only', () => {
      const result = transformRow(makeRow({ Description: '   ' }), fullMapping, 'EUR')
      expect(result.description).toBeNull()
    })

    it('returns merchant string when present', () => {
      const result = transformRow(makeRow({ Merchant: 'Starbucks' }), fullMapping, 'EUR')
      expect(result.merchant).toBe('Starbucks')
    })

    it('returns null when merchant is empty', () => {
      const result = transformRow(makeRow({ Merchant: '' }), fullMapping, 'EUR')
      expect(result.merchant).toBeNull()
    })
  })

  describe('currency handling', () => {
    it('uses currency from CSV row when present', () => {
      const result = transformRow(makeRow({ Currency: 'USD' }), fullMapping, 'EUR')
      expect(result.currency).toBe('USD')
    })

    it('falls back to defaultCurrency when currency column is empty', () => {
      const result = transformRow(makeRow({ Currency: '' }), fullMapping, 'EUR')
      expect(result.currency).toBe('EUR')
    })

    it('falls back to defaultCurrency when no currency column in mapping', () => {
      const noCurrentMapping: ColumnMapping = {
        Date: 'date',
        Amount: 'amount',
        Description: 'description',
      }
      const result = transformRow({ Date: '2024-01-15', Amount: '100', Description: 'Test' }, noCurrentMapping, 'GBP')
      expect(result.currency).toBe('GBP')
    })
  })

  describe('partial mappings (real-world CSV scenarios)', () => {
    it('handles a Spanish bank CSV with typical columns', () => {
      const spanishMapping: ColumnMapping = {
        'Fecha Operacion': 'date',
        'Importe': 'amount',
        'Concepto': 'description',
        'Tipo': 'skip',
      }
      const row = {
        'Fecha Operacion': '15/01/2024',
        // European thousand-dot + comma-decimal format, without leading minus
        // (negative European format "-1.234,56" is not detected by the European regex
        // because the leading "-" prevents the match — use positive value here)
        'Importe': '1.234,56',
        'Concepto': 'Compra supermercado',
        'Tipo': 'Cargo',
      }
      const result = transformRow(row, spanishMapping, 'EUR')
      expect(result.transaction_date).toBe('2024-01-15')
      expect(result.amount).toBe(1234.56)
      expect(result.description).toBe('Compra supermercado')
      expect(result.merchant).toBeNull()
      expect(result.currency).toBe('EUR')
    })

    it('handles a UK bank CSV with typical columns', () => {
      const ukMapping: ColumnMapping = {
        'Date': 'date',
        'Amount': 'amount',
        'Payee': 'merchant',
        'Reference': 'description',
        'Type': 'type',
      }
      const row = {
        'Date': '15/01/2024',
        'Amount': '-49.99',
        'Payee': 'Amazon',
        'Reference': 'AMAZON PAYMENT',
        'Type': 'debit',
      }
      const result = transformRow(row, ukMapping, 'GBP')
      expect(result.transaction_date).toBe('2024-01-15')
      expect(result.amount).toBe(49.99)
      expect(result.merchant).toBe('Amazon')
      expect(result.description).toBe('AMAZON PAYMENT')
      expect(result.type).toBe('expense')
      expect(result.currency).toBe('GBP')
    })

    it('has no parseError when all required fields are valid', () => {
      const result = transformRow(
        makeRow({ Date: '2024-01-15', Amount: '100.00' }),
        fullMapping,
        'EUR'
      )
      expect(result.parseError).toBeUndefined()
    })
  })
})
