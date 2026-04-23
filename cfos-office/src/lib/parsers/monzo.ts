import Papa from 'papaparse'
import type { ParsedTransaction, ParseResult } from './types'
import { parseUKDate } from './uk-date'

// Monzo CSV columns (typical export):
// Date, Time, Type, Name, Emoji, Category, Amount, Currency,
// Local amount, Local currency, Notes and #tags, Address, Receipt,
// Description, Category split, Money Out, Money In, Balance

export function parseMonzoCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    return { ok: false, error: `CSV parse error: ${result.errors[0].message}` }
  }

  const transactions: ParsedTransaction[] = []

  for (const row of result.data) {
    const type = (row['Type'] || '').toLowerCase()
    // Skip pot transfers and empty rows
    if (type === 'pot transfer' || type === '') continue

    const date = parseUKDate(row['Date'] || '')
    if (!date) continue

    // Monzo splits outgoing/incoming into separate columns (both positive).
    // CFO convention: debits negative, credits positive. Negate Money Out,
    // pass Money In through as-is.
    const moneyOut = parseFloat((row['Money Out'] || '0').replace(/[£,]/g, ''))
    const moneyIn = parseFloat((row['Money In'] || '0').replace(/[£,]/g, ''))
    const amount = moneyIn > 0 ? moneyIn : -moneyOut
    if (isNaN(amount) || amount === 0) continue

    const description = (row['Name'] || row['Description'] || '').trim()
    const currency = (row['Currency'] || 'GBP').trim()

    transactions.push({
      date,
      description,
      amount,
      currency,
      source: 'csv_monzo',
      raw_description: (row['Description'] || row['Name'] || '').trim(),
    })
  }

  return { ok: true, transactions }
}

export function isMonzoCSV(headers: string[]): boolean {
  return (
    headers.includes('Money Out') &&
    headers.includes('Money In') &&
    headers.includes('Emoji')
  )
}
