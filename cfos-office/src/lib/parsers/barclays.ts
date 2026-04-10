import Papa from 'papaparse'
import type { ParsedTransaction, ParseResult } from './types'
import { parseUKDate } from './uk-date'

// Barclays CSV columns:
// Number, Date, Account, Amount, Subcategory, Memo

export function parseBarclaysCSV(text: string): ParseResult {
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

    const amountRaw = (row['Amount'] || '').replace(/[£,]/g, '')
    const amount = parseFloat(amountRaw)
    if (isNaN(amount)) continue

    const memo = (row['Memo'] || '').trim()
    const subcategory = (row['Subcategory'] || '').trim()
    const description = memo || subcategory || 'Unknown'

    transactions.push({
      date,
      description,
      amount,
      currency: 'GBP',
      source: 'csv_barclays',
      raw_description: memo || subcategory,
    })
  }

  return { ok: true, transactions }
}

export function isBarclaysCSV(headers: string[]): boolean {
  return headers.includes('Subcategory') && headers.includes('Memo')
}
