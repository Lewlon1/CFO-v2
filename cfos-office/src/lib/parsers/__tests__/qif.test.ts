import { describe, it, expect } from 'vitest'
import { parseQIF } from '../qif'

const QIF_SAMPLE = `!Type:Bank
D15/01/2026
T-42.50
PTESCO LONDON
MGrocery
^
D16/01/2026
T2500.00
PSALARY
^
D20/01/2026
T-9.99
PNetflix
MMonthly subscription
^`

describe('parseQIF', () => {
  it('parses UK-format dates and signed amounts', () => {
    const r = parseQIF(QIF_SAMPLE, 'GBP', 'uk')
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions).toHaveLength(3)

    const [t1, t2, t3] = r.transactions
    expect(t1.date).toBe('2026-01-15T00:00:00Z')
    expect(t1.amount).toBe(-42.5)
    expect(t1.description).toContain('TESCO')

    expect(t2.amount).toBe(2500)
    expect(t3.amount).toBe(-9.99)
    expect(t3.description).toContain('Netflix')
    expect(t3.description).toContain('Monthly')
  })

  it('skips incomplete records missing a date or amount', () => {
    const broken = 'D15/01/2026\n^\nD16/01/2026\nT100\n^'
    const r = parseQIF(broken, 'GBP', 'uk')
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0].amount).toBe(100)
  })

  it('accepts US date order via hint', () => {
    const us = 'D01/15/2026\nT-10\nPX\n^'
    const r = parseQIF(us, 'USD', 'us')
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions[0].date).toBe('2026-01-15T00:00:00Z')
  })
})
