// Generic holdings CSV parser.
//
// Given a header→semantic-field mapping from `detectHoldingsMapping`, turns
// a CSV text blob into an array of `ParsedHolding` rows ready for the user
// to review in the HoldingsPreview component.
//
// Scope note: this is the "generic" parser — it relies on pattern-matched
// headers and platform-agnostic numeric parsing. Platform-specific quirks
// (Vanguard's prices-in-pence, etc.) are left as a future enhancement.

import Papa from 'papaparse'
import type { HoldingsSemanticField } from './holdings-detector'
import type { ParsedHolding, HoldingsParseResult } from './types'

/**
 * Parse a European or Anglo numeric string to a JS number.
 * Handles:
 *   - "£1,234.56"   → 1234.56
 *   - "€1.234,56"   → 1234.56
 *   - "$(1,234.56)" → -1234.56
 *   - "12.5%"       → 12.5
 *   - "-1,234"      → -1234
 * Returns null for empty strings, dashes, or unparseable input.
 */
export function parseLooseNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  let s = String(raw).trim()
  if (!s || s === '-' || s === '—' || s.toLowerCase() === 'n/a') return null

  // Parentheses = negative (accounting format)
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }

  // Strip currency symbols and %
  s = s.replace(/[£€$¥₹%\s]/g, '')

  // Handle leading sign
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }

  if (!s) return null

  // Decide whether the format is European (comma-decimal) or Anglo (dot-decimal).
  // Strategy: look at the last occurrence of `,` and `.`. Whichever appears
  // last is almost certainly the decimal separator; the other is thousands.
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  let normalised: string
  if (lastComma === -1 && lastDot === -1) {
    normalised = s
  } else if (lastComma > lastDot) {
    // European: "1.234,56" — remove dots, turn comma into dot
    normalised = s.replace(/\./g, '').replace(',', '.')
  } else {
    // Anglo: "1,234.56" — remove commas
    normalised = s.replace(/,/g, '')
  }

  const n = Number(normalised)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/**
 * Best-effort inference of account name + provider from a filename.
 * "vanguard_holdings_2026.csv" → { name: "Vanguard Holdings", provider: "Vanguard" }
 */
function inferFromFilename(filename: string | undefined): {
  suggestedAssetName: string | null
  suggestedProvider: string | null
} {
  if (!filename) return { suggestedAssetName: null, suggestedProvider: null }
  const stem = filename.replace(/\.[a-z0-9]+$/i, '')
  const cleaned = stem.replace(/[_\-]+/g, ' ').trim()
  if (!cleaned) return { suggestedAssetName: null, suggestedProvider: null }

  const knownProviders = [
    'vanguard',
    'hargreaves',
    'hl',
    'trading212',
    'trading 212',
    't212',
    'interactive brokers',
    'ibkr',
    'fidelity',
    'schwab',
    'robinhood',
    'etoro',
    'freetrade',
    'nutmeg',
    'moneybox',
    'aj bell',
    'charles stanley',
  ]

  const lower = cleaned.toLowerCase()
  let provider: string | null = null
  for (const p of knownProviders) {
    if (lower.includes(p)) {
      provider = p.replace(/\b\w/g, (m) => m.toUpperCase())
      break
    }
  }

  const titleCased = cleaned.replace(/\b\w/g, (m) => m.toUpperCase())
  return {
    suggestedAssetName: titleCased,
    suggestedProvider: provider,
  }
}

/**
 * True when a row looks like a summary/total line and should be skipped.
 */
function isSummaryRow(row: Record<string, string>, mapping: Record<string, HoldingsSemanticField>): boolean {
  const nameHeader = Object.keys(mapping).find((h) => mapping[h] === 'name')
  const tickerHeader = Object.keys(mapping).find((h) => mapping[h] === 'ticker')

  const nameVal = nameHeader ? (row[nameHeader] ?? '').toLowerCase().trim() : ''
  const tickerVal = tickerHeader ? (row[tickerHeader] ?? '').toLowerCase().trim() : ''

  const SUMMARY_KEYWORDS = ['total', 'grand total', 'subtotal', 'sum', 'balance', 'portfolio total']
  if (SUMMARY_KEYWORDS.some((k) => nameVal === k || nameVal.startsWith(k + ' ') || nameVal.endsWith(' ' + k))) {
    return true
  }
  if (!nameVal && !tickerVal) return true
  return false
}

export function parseHoldingsCSV(
  text: string,
  mapping: Record<string, HoldingsSemanticField>,
  filename?: string
): HoldingsParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { ok: false, error: `Could not parse CSV: ${parsed.errors[0].message}` }
  }

  const rows = parsed.data
  if (rows.length === 0) {
    return { ok: false, error: 'CSV appears to be empty.' }
  }

  // Find which header maps to which field
  const headerFor = (field: HoldingsSemanticField): string | undefined =>
    Object.keys(mapping).find((h) => mapping[h] === field)

  const tickerH = headerFor('ticker')
  const nameH = headerFor('name')
  const quantityH = headerFor('quantity')
  const valueH = headerFor('value')
  const costBasisH = headerFor('cost_basis')
  const priceH = headerFor('price')
  const gainLossH = headerFor('gain_loss')
  const currencyH = headerFor('currency')
  const assetTypeH = headerFor('asset_type')

  const holdings: ParsedHolding[] = []

  for (const row of rows) {
    if (isSummaryRow(row, mapping)) continue

    const ticker = tickerH ? (row[tickerH] ?? '').trim() || null : null
    const name = nameH ? (row[nameH] ?? '').trim() : ''

    // Skip if no identifier at all
    if (!name && !ticker) continue

    const quantity = quantityH ? parseLooseNumber(row[quantityH]) : null
    const currentValue = valueH ? parseLooseNumber(row[valueH]) : null
    const costBasis = costBasisH ? parseLooseNumber(row[costBasisH]) : null
    const pricePerUnit = priceH ? parseLooseNumber(row[priceH]) : null
    let gainLossPct = gainLossH ? parseLooseNumber(row[gainLossH]) : null

    // If the gain/loss column was actually an absolute amount (not a %),
    // derive the percentage from value + cost.
    if (gainLossPct === null && currentValue !== null && costBasis !== null && costBasis !== 0) {
      gainLossPct = ((currentValue - costBasis) / costBasis) * 100
    }

    const currency = currencyH
      ? (row[currencyH] ?? '').trim().toUpperCase() || 'GBP'
      : 'GBP'

    const assetTypeHint = assetTypeH ? (row[assetTypeH] ?? '').trim() || null : null

    holdings.push({
      ticker,
      name: name || ticker || 'Unknown holding',
      quantity,
      current_value: currentValue,
      cost_basis: costBasis,
      price_per_unit: pricePerUnit,
      gain_loss_pct: gainLossPct,
      currency,
      asset_type_hint: assetTypeHint,
      raw_row: row,
    })
  }

  if (holdings.length === 0) {
    return { ok: false, error: 'No holdings rows could be parsed from this file.' }
  }

  const { suggestedAssetName, suggestedProvider } = inferFromFilename(filename)

  return {
    ok: true,
    holdings,
    suggestedAssetName,
    suggestedProvider,
  }
}
