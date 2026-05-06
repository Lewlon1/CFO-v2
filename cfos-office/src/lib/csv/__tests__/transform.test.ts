import { describe, it, expect } from 'vitest'
import { transformRow } from '../transform'

const baseMapping = { Date: 'date', Amount: 'amount', Description: 'description' } as const

// CFO convention: debits negative, credits positive. These tests cover the
// widened applySign keyword set and the paren-negative fallback — the
// regression that caused every transaction for the test user to land with
// positive amounts.
describe('transformRow — sign convention', () => {
  it('honours a signed debit amount when no type column is present', () => {
    const out = transformRow(
      { Date: '2026-01-15', Amount: '-42.00', Description: 'Tesco' },
      baseMapping,
      'GBP',
    )
    expect(out.amount).toBe(-42)
  })

  it('honours a signed credit amount when no type column is present', () => {
    const out = transformRow(
      { Date: '2026-01-15', Amount: '1850.00', Description: 'Salary' },
      baseMapping,
      'GBP',
    )
    expect(out.amount).toBe(1850)
  })

  it('treats paren-wrapped accounting notation as negative', () => {
    const out = transformRow(
      { Date: '2026-01-15', Amount: '(42.00)', Description: 'Tesco' },
      baseMapping,
      'GBP',
    )
    expect(out.amount).toBe(-42)
  })

  it('negates a positive magnitude when Type is "Outgoing"', () => {
    const mapping = { ...baseMapping, Type: 'type' } as const
    const out = transformRow(
      { Date: '2026-01-15', Amount: '42.00', Description: 'Tesco', Type: 'Outgoing' },
      mapping,
      'GBP',
    )
    expect(out.amount).toBe(-42)
  })

  it('negates for "Withdrawal" / "Purchase" / "Payment" / "Sent"', () => {
    const mapping = { ...baseMapping, Type: 'type' } as const
    for (const type of ['Withdrawal', 'Purchase', 'Payment', 'Sent', 'Money Out']) {
      const out = transformRow(
        { Date: '2026-01-15', Amount: '10', Description: 'X', Type: type },
        mapping,
        'GBP',
      )
      expect(out.amount, `type=${type}`).toBe(-10)
    }
  })

  it('keeps positive for "Deposit" / "Incoming" / "Received" / "Refund"', () => {
    const mapping = { ...baseMapping, Type: 'type' } as const
    for (const type of ['Deposit', 'Incoming', 'Received', 'Refund', 'Money In']) {
      const out = transformRow(
        { Date: '2026-01-15', Amount: '10', Description: 'X', Type: type },
        mapping,
        'GBP',
      )
      expect(out.amount, `type=${type}`).toBe(10)
    }
  })

  it('respects Spanish keywords (gasto / ingreso)', () => {
    const mapping = { ...baseMapping, Type: 'type' } as const
    const gasto = transformRow(
      { Date: '2026-01-15', Amount: '10', Description: 'X', Type: 'Gasto' },
      mapping,
      'EUR',
    )
    const ingreso = transformRow(
      { Date: '2026-01-15', Amount: '10', Description: 'X', Type: 'Ingreso' },
      mapping,
      'EUR',
    )
    expect(gasto.amount).toBe(-10)
    expect(ingreso.amount).toBe(10)
  })
})
