import Papa from 'papaparse'
import { detectColumnMapping, isMappingHighConfidence } from '@/lib/csv/column-detector'
import { transformRow } from '@/lib/csv/transform'
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

function applyMapping(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  defaultCurrency: string
): ParseResult {
  const transactions: ParsedTransaction[] = []
  const errors: string[] = []

  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformed = transformRow(row, mapping as any, defaultCurrency)
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
