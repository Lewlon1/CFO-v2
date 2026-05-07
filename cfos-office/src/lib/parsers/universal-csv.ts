// Universal CSV parser — works with any bank export via a FormatTemplate.
// Replaces all hardcoded per-bank parsers. Runs client-side only; the
// full file never leaves the browser.
//
// Sign convention enforced here — this file is the single choke point:
//
//   Debits  → negative  (money leaving the user)
//   Credits → positive  (money arriving for the user)
//
// Every downstream consumer (gap analysis, surplus, Values View, CFO
// insights) assumes that invariant. Breaking it here breaks everything.

import Papa from 'papaparse'
import type {
  DecimalFormat,
  FormatTemplate,
  ParsedTransaction,
  UniversalParseResult,
} from './types'

export function parseUniversalCSV(
  text: string,
  template: FormatTemplate,
): UniversalParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  if (!parsed.data || parsed.data.length === 0) {
    return { ok: false, error: 'CSV has no data rows' }
  }

  const cols = template.columnMapping
  const transactions: ParsedTransaction[] = []
  const warnings: string[] = []
  let skippedRows = 0

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i]
    const lineNumber = i + 2 // +1 for header, +1 for 1-indexed display

    const date = parseDate(row[cols.date] ?? '', template.dateFormat)
    if (!date) {
      skippedRows++
      if (warnings.length < 10) warnings.push(`Row ${lineNumber}: unparseable date "${row[cols.date] ?? ''}"`)
      continue
    }

    const amount = resolveAmount(row, template)
    if (amount === null || !Number.isFinite(amount)) {
      skippedRows++
      if (warnings.length < 10) warnings.push(`Row ${lineNumber}: unparseable amount`)
      continue
    }

    // Drop zero-amount rows — usually balance-summary artefacts, not
    // real movements. Non-zero transfers in both directions are kept.
    if (amount === 0) {
      skippedRows++
      continue
    }

    const description = (row[cols.description] ?? '').trim()
    const currency = cols.currency
      ? (row[cols.currency] ?? '').trim() || template.currencyDefault
      : template.currencyDefault

    const balance = cols.balance ? parseAmount(row[cols.balance] ?? '', template.decimalFormat) : null

    transactions.push({
      date,
      description: description || '(no description)',
      amount,
      currency: currency || template.currencyDefault,
      source: 'csv_universal',
      raw_description: description,
      balance: balance !== null && Number.isFinite(balance) ? balance : null,
    })
  }

  if (skippedRows > 0 && warnings.length === 0) {
    warnings.push(`${skippedRows} rows skipped (unparseable date or amount).`)
  }

  if (transactions.length === 0) {
    return {
      ok: false,
      error: 'No valid transactions found. Header mapping may be wrong.',
      warnings,
    }
  }

  return { ok: true, transactions, template, skippedRows, warnings }
}

// ── template repair ────────────────────────────────────────────────
// Haiku sometimes picks a non-numeric column for amount (e.g. BBVA's
// "Movement" column which is narrative text, not values). Before we
// commit to parseUniversalCSV, verify the chosen amount column
// actually contains numbers in the first rows. If it doesn't, swap in
// the first column that does.

// Stricter numeric check than parseAmount: rejects date-like values
// ("22/04/2026" would clean to a valid number otherwise), requires a
// decimal fraction OR a leading sign OR digits only.
const MONEY_LIKE =
  /^[\s€$£¥()+]*[-−]?[\s€$£¥()+]*(?:\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)[\s€$£¥()+]*$/

function columnIsNumeric(
  rows: Record<string, string>[],
  col: string,
  format: DecimalFormat,
  minFraction = 0.6,
): boolean {
  const sample = rows.slice(0, 10).map((r) => (r[col] ?? '').trim()).filter((v) => v !== '')
  if (sample.length === 0) return false
  const numericLike = sample.filter((v) => {
    if (v.includes('/')) return false // dates
    if (!MONEY_LIKE.test(v)) return false
    return parseAmount(v, format) !== null
  }).length
  return numericLike / sample.length >= minFraction
}

export function repairTemplate(
  text: string,
  template: FormatTemplate,
): FormatTemplate {
  // Only repairs the signed_single_column path for now — it's the bug
  // source for XLSX exports with narrative-named columns.
  if (template.signConvention !== 'signed_single_column') return template
  const cols = template.columnMapping
  if (!cols.amount) return template

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    preview: 10,
    transformHeader: (h) => h.trim(),
  })
  if (!parsed.data || parsed.data.length === 0) return template

  if (columnIsNumeric(parsed.data, cols.amount, template.decimalFormat)) {
    return template
  }

  // The chosen column isn't numeric. Scan headers and pick the first
  // one whose values parse as amounts. Prefer headers whose name hints
  // at money (contains "amount", "importe", "cantidad", "value") among
  // the numeric candidates.
  const allHeaders = parsed.meta.fields ?? []
  const excluded = new Set<string | undefined>([
    cols.date, cols.description, cols.balance, cols.currency,
  ])
  const numericCols = allHeaders.filter(
    (h) => !excluded.has(h) && columnIsNumeric(parsed.data, h, template.decimalFormat),
  )
  if (numericCols.length === 0) return template

  const moneyRegex = /amount|importe|cantidad|value|monto|valeur|betrag/i
  const preferred = numericCols.find((h) => moneyRegex.test(h)) ?? numericCols[0]
  return {
    ...template,
    columnMapping: { ...cols, amount: preferred },
  }
}

// ── amount resolution ──────────────────────────────────────────────

function resolveAmount(
  row: Record<string, string>,
  template: FormatTemplate,
): number | null {
  const cols = template.columnMapping
  const fmt = template.decimalFormat

  switch (template.signConvention) {
    case 'signed_single_column': {
      if (!cols.amount) return null
      return parseAmount(row[cols.amount] ?? '', fmt)
    }
    case 'split_in_out': {
      // Monzo's pattern (see monzo.ts:33): one column has the value,
      // the other is empty. Credit positive, debit becomes negative.
      if (!cols.credit || !cols.debit) return null
      const credit = parseAmount(row[cols.credit] ?? '', fmt) ?? 0
      const debit = parseAmount(row[cols.debit] ?? '', fmt) ?? 0
      return credit - debit
    }
    case 'type_flag': {
      if (!cols.amount || !cols.type_flag || !cols.type_flag_values) return null
      const mag = parseAmount(row[cols.amount] ?? '', fmt)
      if (mag === null) return null
      const magnitude = Math.abs(mag)
      const flag = (row[cols.type_flag] ?? '').trim()
      const { debit, credit } = cols.type_flag_values
      if (flag === debit) return -magnitude
      if (flag === credit) return magnitude
      // Unknown flag — fall back to the raw sign (Haiku sometimes
      // stores already-signed magnitudes with a DR/CR column as metadata).
      return mag
    }
  }
}

// Strip currency symbols, thousands separators, and whitespace, then
// parse. Handles both decimal conventions:
//
//   dot  : 1,234.56  or  $1,234.56  → 1234.56
//   comma: 1.234,56  or  1234,56    → 1234.56
//
// Returns null on empty input so callers can distinguish "missing" from
// "zero".
export function parseAmount(raw: string, format: DecimalFormat): number | null {
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  if (trimmed === '') return null

  // Normalise Unicode minus variants to ASCII hyphen. Spanish bank
  // XLSX exports use U+2212 (−), some PDFs use U+2013 (–) or U+2212.
  const normalised = trimmed.replace(/[\u2212\u2013\u2014]/g, '-')

  // Remove currency symbols and whitespace. Keep digits, signs, dots, commas.
  let cleaned = normalised.replace(/[^\d.,\-+]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null

  if (format === 'comma') {
    // European: dots are thousands, commas are decimal.
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    // UK/US: commas are thousands, dots are decimal.
    cleaned = cleaned.replace(/,/g, '')
  }

  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

// ── date parsing ───────────────────────────────────────────────────

// Matches uk-date.ts behaviour: output is always
//   YYYY-MM-DDT00:00:00Z
// (or YYYY-MM-DDTHH:mm:ssZ when a time is present and the format
// supports it). Unparseable input returns ''.
export function parseDate(raw: string, format: string): string {
  if (!raw) return ''
  const trimmed = String(raw).trim()
  if (!trimmed) return ''

  const upper = format.toUpperCase()

  // ISO or anything that starts with YYYY-MM-DD
  if (upper === 'ISO' || upper === 'YYYY-MM-DD') {
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
    if (m) {
      const [, y, mo, d, h, mi, s] = m
      const time = h ? `${h}:${mi}:${s ?? '00'}` : '00:00:00'
      return `${y}-${mo}-${d}T${time}Z`
    }
  }

  // UK and EU
  if (upper === 'DD/MM/YYYY' || upper === 'DD-MM-YYYY' || upper.startsWith('DD')) {
    const m = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[T ](\d{2}):(\d{2}))?/)
    if (m) {
      const [, day, month, yearRaw, hh, mm] = m
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
      const time = hh ? `${hh}:${mm}:00` : '00:00:00'
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${time}Z`
    }
  }

  // US
  if (upper === 'MM/DD/YYYY' || upper.startsWith('MM')) {
    const m = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
    if (m) {
      const [, month, day, yearRaw] = m
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`
    }
  }

  // Last-chance fallback: let Date parse it (handles RFC 2822 + ISO variants).
  const d = new Date(trimmed)
  if (!Number.isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}T00:00:00Z`
  }

  return ''
}
