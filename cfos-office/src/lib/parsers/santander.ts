import * as XLSX from 'xlsx'
import type { ParsedTransaction, ParseResult } from './types'

export function parseSantanderXLSX(buffer: ArrayBuffer): ParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'array', codepage: 1252 })
  } catch {
    return { ok: false, error: 'Could not read XLSX file. Make sure it is a valid Excel file.' }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { ok: false, error: 'No sheets found in XLSX file.' }

  const sheet = workbook.Sheets[sheetName]
  // Get raw rows as arrays (Santander doesn't always have clean headers)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })

  if (rows.length < 2) return { ok: false, error: 'No data rows found in XLSX file.' }

  // Find header row — look for a row containing date-like and amount-like headers
  let headerRowIndex = 0
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i].map((c) => String(c ?? '').toLowerCase())
    if (row.some((c) => /fecha|date/.test(c)) && row.some((c) => /importe|amount|cargo/.test(c))) {
      headerRowIndex = i
      break
    }
  }

  const headers = rows[headerRowIndex].map((c) => String(c ?? '').trim())
  const dateCol = headers.findIndex((h) => /fecha|date/i.test(h))
  const amountCol = headers.findIndex((h) => /importe|amount|cargo/i.test(h))
  const descCol = headers.findIndex((h) => /concepto|descripci|description|motivo/i.test(h))
  // Optional running-balance column — "Saldo" in Spanish Santander exports.
  // Missing column => -1, which we treat as "no balance available".
  const balanceCol = headers.findIndex((h) => /saldo|balance/i.test(h))

  if (dateCol === -1 || amountCol === -1 || descCol === -1) {
    return {
      ok: false,
      error: 'Could not find date, amount, or description columns. Try the generic import.',
    }
  }

  const transactions: ParsedTransaction[] = []

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row[dateCol] || !row[amountCol]) continue

    const rawDate = String(row[dateCol] ?? '').trim()
    const rawAmount = String(row[amountCol] ?? '').trim()
    const rawDesc = String(row[descCol] ?? '').trim()

    const date = parseSantanderDate(rawDate)
    if (!date) continue

    const amount = parseSantanderAmount(rawAmount)
    if (isNaN(amount)) continue

    const description = rawDesc || 'Unknown'

    // Parse the Saldo column using the same Spanish decimal handling as
    // amount. When the column is absent (balanceCol === -1) or the value is
    // unparseable we store null so detectors can skip it.
    let balance: number | null = null
    if (balanceCol !== -1) {
      const rawBalance = String(row[balanceCol] ?? '').trim()
      if (rawBalance) {
        const parsed = parseSantanderAmount(rawBalance)
        balance = Number.isFinite(parsed) ? parsed : null
      }
    }

    transactions.push({
      date,
      description,
      amount,
      currency: 'EUR', // Santander ES is EUR
      source: 'csv_santander',
      raw_description: description,
      balance,
    })
  }

  if (transactions.length === 0) {
    return { ok: false, error: 'No valid transactions found in the Santander file.' }
  }

  return { ok: true, transactions }
}

function parseSantanderDate(raw: string): string {
  // Santander XLSX exports are intentionally date-only — the source file
  // does not carry time-of-day. Rows land at 00:00:00Z and time-based
  // contextual rules will not apply to them.
  // DD/MM/YYYY or DD-MM-YYYY
  const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // ISO fallback
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  return ''
}

function parseSantanderAmount(raw: string): number {
  // Spanish format: 1.234,56 (dot = thousands, comma = decimal)
  let cleaned = raw.replace(/[^\d,.\-+]/g, '').trim()
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.')
  }
  return parseFloat(cleaned)
}

export function isSantanderFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.xlsx') || filename.toLowerCase().endsWith('.xls')
}
