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

    transactions.push({
      date,
      description,
      amount, // Revolut amounts are already signed
      currency,
      source: 'csv_revolut',
      raw_description: description,
    })
  }

  return { ok: true, transactions }
}

function parseRevolutDate(raw: string): string {
  if (!raw) return ''
  // Format: "2026-01-15 14:23:00" or "2026-01-15"
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

export function isRevolutCSV(headers: string[]): boolean {
  const required = ['Completed Date', 'Description', 'Amount', 'Currency', 'State']
  return required.every((h) => headers.includes(h))
}
