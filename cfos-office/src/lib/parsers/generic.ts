import Papa from 'papaparse'
import { detectColumnMapping, isMappingHighConfidence } from '@/lib/csv/column-detector'
import { transformRow, type ColumnMapping } from '@/lib/csv/transform'
import type { ParsedTransaction, ParseResult } from './types'

export type ColumnMappingNeeded = {
  needsMapping: true
  headers: string[]
  autoMapping: Record<string, string>
  rawRows: Record<string, string>[]
}

/**
 * First pass: parse headers, auto-detect columns.
 * Returns either ready transactions (high confidence) or the raw data
 * for the ColumnMapper UI to handle.
 */
export function parseGenericCSV(
  text: string,
  defaultCurrency = 'EUR'
): ParseResult | ColumnMappingNeeded {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    return { ok: false, error: `CSV parse error: ${result.errors[0].message}` }
  }

  const headers = result.meta.fields ?? []
  const autoMapping = detectColumnMapping(headers)

  if (!isMappingHighConfidence(autoMapping)) {
    return {
      needsMapping: true,
      headers,
      autoMapping: autoMapping as Record<string, string>,
      rawRows: result.data,
    }
  }

  return applyMapping(result.data, autoMapping as Record<string, string>, defaultCurrency)
}

/**
 * Second pass: apply a confirmed column mapping to raw rows.
 * Called after ColumnMapper UI confirms mapping.
 */
export function applyColumnMapping(
  rawRows: Record<string, string>[],
  mapping: Record<string, string>,
  defaultCurrency = 'EUR'
): ParseResult {
  return applyMapping(rawRows, mapping, defaultCurrency)
}

// Generic CSV imports preserve time-of-day when the source provides it
// (see lib/csv/transform.ts → parseDate). When the source is date-only,
// rows land at 00:00:00Z and time-based contextual rules won't apply.
function applyMapping(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  defaultCurrency: string
): ParseResult {
  const transactions: ParsedTransaction[] = []
  const errors: string[] = []

  for (const row of rows) {
    // mapping arrives as Record<string, string> from the API request body; values
    // are user/auto-confirmed SemanticField identifiers. transformRow only reads
    // entries whose value is a known SemanticField, so an unknown string is a no-op.
    const transformed = transformRow(row, mapping as ColumnMapping, defaultCurrency)
    if (transformed.parseError) {
      errors.push(transformed.parseError)
      continue
    }
    if (!transformed.description) continue

    transactions.push({
      date: transformed.date,
      description: transformed.description,
      amount: transformed.amount,
      currency: transformed.currency,
      source: 'csv_generic',
      raw_description: transformed.description,
    })
  }

  if (transactions.length === 0 && errors.length > 0) {
    return { ok: false, error: errors[0] }
  }

  return { ok: true, transactions }
}
