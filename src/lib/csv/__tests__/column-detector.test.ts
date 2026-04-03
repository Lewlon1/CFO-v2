import { describe, it, expect } from 'vitest'
import { detectColumnMapping } from '../column-detector'

describe('detectColumnMapping', () => {
  describe('English column names', () => {
    it('detects all standard English columns', () => {
      const result = detectColumnMapping(['Date', 'Amount', 'Description', 'Merchant', 'Type', 'Currency'])
      expect(result).toEqual({
        Date: 'date',
        Amount: 'amount',
        Description: 'description',
        Merchant: 'merchant',
        Type: 'type',
        Currency: 'currency',
      })
    })

    it('detects "transaction_date"', () => {
      expect(detectColumnMapping(['transaction_date'])['transaction_date']).toBe('date')
    })

    it('detects "value_date"', () => {
      expect(detectColumnMapping(['value_date'])['value_date']).toBe('date')
    })

    it('detects "booking"', () => {
      expect(detectColumnMapping(['booking date'])['booking date']).toBe('date')
    })

    it('detects "details"', () => {
      expect(detectColumnMapping(['Details'])['Details']).toBe('description')
    })

    it('detects "memo"', () => {
      expect(detectColumnMapping(['Memo'])['Memo']).toBe('description')
    })

    it('detects "reference"', () => {
      expect(detectColumnMapping(['Reference'])['Reference']).toBe('description')
    })

    it('detects "narrative"', () => {
      expect(detectColumnMapping(['Narrative'])['Narrative']).toBe('description')
    })

    it('detects "payee"', () => {
      expect(detectColumnMapping(['Payee'])['Payee']).toBe('merchant')
    })

    it('detects "category"', () => {
      expect(detectColumnMapping(['Category'])['Category']).toBe('type')
    })
  })

  describe('Spanish column names', () => {
    it('detects all standard Spanish columns', () => {
      const result = detectColumnMapping(['Fecha', 'Importe', 'Concepto', 'Comercio', 'Tipo', 'Moneda'])
      expect(result).toEqual({
        Fecha: 'date',
        Importe: 'amount',
        Concepto: 'description',
        Comercio: 'merchant',
        Tipo: 'type',
        Moneda: 'currency',
      })
    })

    it('detects "monto"', () => {
      expect(detectColumnMapping(['monto'])['monto']).toBe('amount')
    })

    it('detects "cantidad"', () => {
      expect(detectColumnMapping(['cantidad'])['cantidad']).toBe('amount')
    })

    it('detects "cargo"', () => {
      expect(detectColumnMapping(['cargo'])['cargo']).toBe('amount')
    })

    it('detects "descripcion"', () => {
      expect(detectColumnMapping(['descripcion'])['descripcion']).toBe('description')
    })

    it('detects "motivo"', () => {
      expect(detectColumnMapping(['motivo'])['motivo']).toBe('description')
    })

    it('detects "beneficiario"', () => {
      expect(detectColumnMapping(['beneficiario'])['beneficiario']).toBe('merchant')
    })

    it('detects "movimiento"', () => {
      expect(detectColumnMapping(['movimiento'])['movimiento']).toBe('type')
    })
  })

  describe('German column names', () => {
    it('detects "Datum"', () => {
      expect(detectColumnMapping(['Datum'])['Datum']).toBe('date')
    })

    it('detects "Betrag"', () => {
      expect(detectColumnMapping(['Betrag'])['Betrag']).toBe('amount')
    })

    it('detects "Währung"', () => {
      expect(detectColumnMapping(['Währung'])['Währung']).toBe('currency')
    })
  })

  describe('French column names', () => {
    it('detects "montant"', () => {
      expect(detectColumnMapping(['montant'])['montant']).toBe('amount')
    })

    it('detects "remarque"', () => {
      expect(detectColumnMapping(['remarque'])['remarque']).toBe('description')
    })

    it('detects "devise"', () => {
      expect(detectColumnMapping(['devise'])['devise']).toBe('currency')
    })

    it('detects "nature"', () => {
      expect(detectColumnMapping(['nature'])['nature']).toBe('type')
    })
  })

  describe('case insensitivity', () => {
    it('detects uppercase "DATE"', () => {
      expect(detectColumnMapping(['DATE'])['DATE']).toBe('date')
    })

    it('detects lowercase "amount"', () => {
      expect(detectColumnMapping(['amount'])['amount']).toBe('amount')
    })

    it('detects mixed case "Description"', () => {
      expect(detectColumnMapping(['Description'])['Description']).toBe('description')
    })

    it('detects "FECHA"', () => {
      expect(detectColumnMapping(['FECHA'])['FECHA']).toBe('date')
    })
  })

  describe('unknown columns', () => {
    it('marks completely unknown columns as skip', () => {
      const result = detectColumnMapping(['IBAN', 'AccountNumber', 'SortCode'])
      expect(result['IBAN']).toBe('skip')
      expect(result['AccountNumber']).toBe('skip')
      expect(result['SortCode']).toBe('skip')
    })

    it('marks empty string header as skip', () => {
      expect(detectColumnMapping([''])['']  ).toBe('skip')
    })
  })

  describe('duplicate field prevention', () => {
    it('only maps the first matching column to "date", skips subsequent', () => {
      const result = detectColumnMapping(['Date', 'Transaction Date', 'Booking Date'])
      const dateFields = Object.values(result).filter(v => v === 'date')
      expect(dateFields).toHaveLength(1)
    })

    it('only maps the first matching column to "amount", skips subsequent', () => {
      const result = detectColumnMapping(['Amount', 'Importe'])
      const amountFields = Object.values(result).filter(v => v === 'amount')
      expect(amountFields).toHaveLength(1)
    })

    it('assigns first match to the field and marks rest as skip', () => {
      const result = detectColumnMapping(['Date', 'Fecha'])
      // 'Date' comes first → gets 'date'; 'Fecha' → 'skip'
      expect(result['Date']).toBe('date')
      expect(result['Fecha']).toBe('skip')
    })
  })

  describe('edge cases', () => {
    it('returns empty object for empty array', () => {
      expect(detectColumnMapping([])).toEqual({})
    })

    it('handles whitespace in header names', () => {
      expect(detectColumnMapping(['  fecha  '])['  fecha  ']).toBe('date')
    })

    it('handles single column array', () => {
      const result = detectColumnMapping(['Amount'])
      expect(result).toEqual({ Amount: 'amount' })
    })

    it('returns a mapping entry for every input header', () => {
      const headers = ['Date', 'Amount', 'Notes', 'IBAN', 'Description']
      const result = detectColumnMapping(headers)
      expect(Object.keys(result)).toHaveLength(headers.length)
    })
  })
})
