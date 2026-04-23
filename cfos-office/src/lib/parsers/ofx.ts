// OFX 1.x (SGML) and OFX 2.x (XML) parser — no LLM needed.
//
// Both variants share the same element names; we only need <STMTTRN>
// blocks. OFX 1.x is SGML-ish (no closing tags for scalars); OFX 2.x is
// strict XML. A single tag-scanning regex works for both because we only
// consume content up to the next opening tag or block boundary.
//
// Sign convention is baked into the format: TRNAMT is signed, so debits
// are already negative and credits positive. We pass it through.

import type { ParseResult, ParsedTransaction } from './types'

const STMTTRN_RE = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi

export function parseOFX(text: string, defaultCurrency = 'GBP'): ParseResult {
  if (!text || typeof text !== 'string') {
    return { ok: false, error: 'Empty OFX input' }
  }

  // Statement-level default currency (CURDEF appears once in the header).
  const currency =
    scalar(text, 'CURDEF')?.toUpperCase() || defaultCurrency.toUpperCase()

  const transactions: ParsedTransaction[] = []
  let match: RegExpExecArray | null
  while ((match = STMTTRN_RE.exec(text)) !== null) {
    const block = match[1]
    const dateRaw = scalar(block, 'DTPOSTED')
    const amountRaw = scalar(block, 'TRNAMT')
    if (!dateRaw || !amountRaw) continue

    const amount = parseFloat(amountRaw)
    if (!Number.isFinite(amount) || amount === 0) continue

    const date = parseOfxDate(dateRaw)
    if (!date) continue

    const name = scalar(block, 'NAME') ?? ''
    const memo = scalar(block, 'MEMO') ?? ''
    const description = [name, memo].filter(Boolean).join(' — ').trim() || '(no description)'

    transactions.push({
      date,
      description,
      amount,
      currency,
      source: 'ofx',
      raw_description: description,
      balance: null,
    })
  }

  if (transactions.length === 0) {
    return { ok: false, error: 'No <STMTTRN> blocks found in OFX' }
  }
  return { ok: true, transactions }
}

// Extract a scalar OFX value. Handles both SGML ("<TAG>value\n") and
// XML ("<TAG>value</TAG>") by reading until the next tag or newline.
function scalar(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, 'i')
  const m = block.match(re)
  if (!m) return null
  const value = m[1].trim()
  return value === '' ? null : value
}

// OFX dates are YYYYMMDD or YYYYMMDDHHMMSS with optional fractional
// seconds and a timezone offset in brackets, e.g. "20260115120000[+0:GMT]".
function parseOfxDate(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/)
  if (!m) return ''
  const [, y, mo, d, hh, mm, ss] = m
  const time = hh ? `${hh}:${mm}:${ss ?? '00'}` : '00:00:00'
  return `${y}-${mo}-${d}T${time}Z`
}
