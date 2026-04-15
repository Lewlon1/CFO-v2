import Papa from 'papaparse'
import type { ParsedTransaction, ParseResult } from './types'

// Revolut CSV columns: Type, Product, Started Date, Completed Date,
// Description, Amount, Fee, Currency, State, Balance

export function parseRevolutCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    return { ok: false, error: `CSV parse error: ${result.errors[0].message}` }
  }

  const transactions: ParsedTransaction[] = []

  for (const row of result.data) {
    // Only process completed transactions
    if (row['State'] !== 'COMPLETED') continue

    const rawDate = row['Completed Date'] || row['Started Date'] || ''
    const date = parseRevolutDate(rawDate)
    if (!date) continue

    const rawAmount = row['Amount'] || ''
    const amount = parseFloat(rawAmount.replace(',', '.'))
    if (isNaN(amount)) continue

    const description = (row['Description'] || '').trim()
    const currency = (row['Currency'] || 'EUR').trim()

    // Revolut exports include a running-balance column (`Balance`) using `.`
    // as decimal separator. Older/variant exports may omit it, in which case
    // we leave the field null so downstream detectors (balance_trajectory)
    // skip these rows cleanly.
    const rawBalance = row['Balance']
    let balance: number | null = null
    if (rawBalance !== undefined && rawBalance !== '') {
      const parsed = parseFloat(rawBalance.replace(',', '.'))
      balance = Number.isFinite(parsed) ? parsed : null
    }

    transactions.push({
      date,
      description,
      amount, // Revolut amounts are already signed
      currency,
      source: 'csv_revolut',
      raw_description: description,
      balance,
    })
  }

  return { ok: true, transactions }
}

function parseRevolutDate(raw: string): string {
  if (!raw) return ''
  // Revolut exports timestamps as "2026-01-15 14:23:00" (UTC) or sometimes
  // bare "2026-01-15". We preserve the time when present so contextual rules
  // (e.g. "Aldi after 6pm = Leak") have something to match against.
  const withTime = raw.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{2}:\d{2}:\d{2})/)
  if (withTime) return `${withTime[1]}T${withTime[2]}Z`
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (dateOnly) return `${dateOnly[1]}T00:00:00Z`
  return ''
}

export function isRevolutCSV(headers: string[]): boolean {
  const required = ['Completed Date', 'Description', 'Amount', 'Currency', 'State']
  return required.every((h) => headers.includes(h))
}
