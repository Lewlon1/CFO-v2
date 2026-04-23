import Papa from 'papaparse'
import type { ParsedTransaction, ParseResult } from './types'
import { parseUKDate } from './uk-date'

// Starling CSV columns:
// Date, Counter Party, Reference, Type, Amount (GBP), Balance (GBP), Spending Category

export function parseStarlingCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    return { ok: false, error: `CSV parse error: ${result.errors[0].message}` }
  }

  const transactions: ParsedTransaction[] = []

  for (const row of result.data) {
    const date = parseUKDate(row['Date'] || '')
    if (!date) continue

    const rawAmount = (row['Amount (GBP)'] || '').replace(/[£,]/g, '')
    const amount = parseFloat(rawAmount)
    if (isNaN(amount)) continue

    const counterParty = (row['Counter Party'] || '').trim()
    const reference = (row['Reference'] || '').trim()
    const description = counterParty || reference || 'Unknown'

    transactions.push({
      date,
      description,
      // CFO convention: debits negative, credits positive.
      // Starling's Amount (GBP) column is pre-signed in the source export.
      amount,
      currency: 'GBP',
      source: 'csv_starling',
      raw_description: `${counterParty} ${reference}`.trim(),
    })
  }

  return { ok: true, transactions }
}

export function isStarlingCSV(headers: string[]): boolean {
  return (
    headers.includes('Counter Party') &&
    headers.includes('Amount (GBP)')
  )
}
