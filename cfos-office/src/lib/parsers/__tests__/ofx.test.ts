import { describe, it, expect } from 'vitest'
import { parseOFX } from '../ofx'

const OFX_SAMPLE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>GBP
<BANKACCTFROM>
<ACCTID>12345678
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260115120000[+0:GMT]
<TRNAMT>-42.50
<FITID>TXN001
<NAME>TESCO LONDON
<MEMO>Grocery
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260116
<TRNAMT>2500.00
<FITID>TXN002
<NAME>SALARY
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

describe('parseOFX', () => {
  it('extracts both debit and credit transactions with correct signs', () => {
    const r = parseOFX(OFX_SAMPLE)
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions).toHaveLength(2)

    const [debit, credit] = r.transactions
    expect(debit.amount).toBe(-42.5)
    expect(debit.description).toContain('TESCO')
    expect(debit.currency).toBe('GBP')
    expect(debit.date).toBe('2026-01-15T12:00:00Z')

    expect(credit.amount).toBe(2500)
    expect(credit.date).toBe('2026-01-16T00:00:00Z')
  })

  it('defaults currency when CURDEF is absent', () => {
    const stripped = OFX_SAMPLE.replace(/<CURDEF>GBP\s*/, '')
    const r = parseOFX(stripped, 'EUR')
    if (!r.ok) throw new Error(r.error)
    expect(r.transactions[0].currency).toBe('EUR')
  })

  it('fails gracefully on empty input', () => {
    const r = parseOFX('')
    expect(r.ok).toBe(false)
  })
})
