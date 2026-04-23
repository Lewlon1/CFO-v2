// QIF (Quicken Interchange Format) parser — no LLM needed.
//
// QIF is a line-based format with single-char prefixes:
//   D = date
//   T = amount (signed)
//   P = payee
//   M = memo
//   N = check number / reference
//   ^ = record terminator
//
// Dates are locale-dependent. Default assumption: UK (DD/MM/YYYY) since
// that's our primary user base; callers can pass explicit hints via
// `dateHint`. Amounts are already signed (debits negative).

import type { ParseResult, ParsedTransaction } from './types'

export function parseQIF(
  text: string,
  defaultCurrency = 'GBP',
  dateHint: 'uk' | 'us' = 'uk',
): ParseResult {
  if (!text || typeof text !== 'string') {
    return { ok: false, error: 'Empty QIF input' }
  }

  const lines = text.split(/\r?\n/)
  const transactions: ParsedTransaction[] = []
  let cur: Partial<{ date: string; amount: number; payee: string; memo: string }> = {}

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line) continue

    const prefix = line[0]
    const value = line.slice(1).trim()

    if (prefix === '^') {
      if (cur.date && typeof cur.amount === 'number' && cur.amount !== 0) {
        const description = [cur.payee, cur.memo].filter(Boolean).join(' — ').trim() || '(no description)'
        transactions.push({
          date: cur.date,
          description,
          amount: cur.amount,
          currency: defaultCurrency,
          source: 'qif',
          raw_description: description,
          balance: null,
        })
      }
      cur = {}
      continue
    }

    switch (prefix) {
      case 'D':
        cur.date = parseQifDate(value, dateHint)
        break
      case 'T':
      case 'U': {
        // Amounts can contain thousands separators and negative signs.
        const cleaned = value.replace(/[^\d.,\-+]/g, '').replace(/,/g, '')
        const n = parseFloat(cleaned)
        if (Number.isFinite(n)) cur.amount = n
        break
      }
      case 'P':
        cur.payee = value
        break
      case 'M':
        cur.memo = value
        break
      // N (check #), L (category), C (cleared), A (address), S (split) — ignored.
    }
  }

  if (transactions.length === 0) {
    return { ok: false, error: 'No transactions found in QIF' }
  }
  return { ok: true, transactions }
}

function parseQifDate(raw: string, hint: 'uk' | 'us'): string {
  // Quicken's weird 2-digit year prefix: D12/07'26 → 2026. Also accepts
  // D12/07/2026 and D12-07-26.
  const normalised = raw.replace(/'/g, '/').replace(/\s+/g, '')
  const m = normalised.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (!m) return ''
  const [, a, b, yearRaw] = m
  const year = yearRaw.length === 2 ? (parseInt(yearRaw, 10) < 50 ? `20${yearRaw}` : `19${yearRaw}`) : yearRaw
  const [day, month] = hint === 'uk' ? [a, b] : [b, a]
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`
}
