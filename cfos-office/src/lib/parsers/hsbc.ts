import Papa from 'papaparse'
import type { ParsedTransaction, ParseResult } from './types'
import { parseUKDate } from './uk-date'

// HSBC CSV is minimal: Date, Description, Amount
// Some exports have no header row — just 3 columns.

export function parseHsbcCSV(text: string): ParseResult {
  // Try with headers first
  const withHeaders = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  const headers = withHeaders.meta.fields ?? []
  const hasHeaders =
    headers.length >= 3 &&
    headers.some((h) => /date/i.test(h)) &&
    headers.some((h) => /amount/i.test(h))

  if (hasHeaders) {
    return parseWithHeaders(withHeaders.data)
  }

  // No headers — parse as positional columns: [date, description, amount]
  const noHeaders = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  })
  return parsePositional(noHeaders.data)
}

function parseWithHeaders(rows: Record<string, string>[]): ParseResult {
  const transactions: ParsedTransaction[] = []

  for (const row of rows) {
    const dateRaw = row['Date'] || row['date'] || ''
    const date = parseUKDate(dateRaw)
    if (!date) continue

    const amountRaw = (row['Amount'] || row['amount'] || '').replace(/[£,]/g, '')
    const amount = parseFloat(amountRaw)
    if (isNaN(amount)) continue

    const description = (
      row['Description'] || row['description'] || 'Unknown'
    ).trim()

    transactions.push({
      date,
      description,
      // CFO convention: debits negative, credits positive.
      // HSBC's single Amount column is pre-signed in the source export.
      amount,
      currency: 'GBP',
      source: 'csv_hsbc',
      raw_description: description,
    })
  }

  return { ok: true, transactions }
}

function parsePositional(rows: string[][]): ParseResult {
  const transactions: ParsedTransaction[] = []

  for (const row of rows) {
    if (row.length < 3) continue

    const date = parseUKDate(row[0])
    if (!date) continue

    const amount = parseFloat(row[2].replace(/[£,]/g, ''))
    if (isNaN(amount)) continue

    const description = (row[1] || 'Unknown').trim()

    transactions.push({
      date,
      description,
      // CFO convention: debits negative, credits positive.
      // HSBC's headerless export preserves the signed amount in column 3.
      amount,
      currency: 'GBP',
      source: 'csv_hsbc',
      raw_description: description,
    })
  }

  return { ok: true, transactions }
}

export function isHsbcCSV(headers: string[], firstRows?: string[][]): boolean {
  // With headers: exactly 3 columns named Date, Description, Amount
  if (
    headers.length === 3 &&
    headers.some((h) => /^date$/i.test(h.trim())) &&
    headers.some((h) => /^amount$/i.test(h.trim()))
  ) {
    return true
  }

  // No headers: exactly 3 columns where first looks like a date
  if (firstRows && firstRows.length > 0) {
    const first = firstRows[0]
    if (first.length === 3 && parseUKDate(first[0]) !== '') {
      return true
    }
  }

  return false
}
