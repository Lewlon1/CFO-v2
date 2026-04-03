// Stub — CSV row transformation will be implemented in Session 3
import type { ColumnMapping } from './column-detector'

export interface TransformedRow {
  date: string
  description: string
  merchant: string | null
  amount: number
  currency: string
  type: string
  transaction_date: string
  is_recurring?: boolean
  category_name?: string | null
  raw_category?: string | null
  parseError?: string
}

export function transformRow(
  _row: Record<string, string>,
  _mapping: ColumnMapping,
  _currency?: string
): TransformedRow {
  return {
    date: '',
    description: '',
    merchant: null,
    amount: 0,
    currency: _currency ?? 'GBP',
    type: 'unknown',
    transaction_date: '',
    is_recurring: false,
    category_name: null,
    parseError: 'CSV parsing not yet implemented',
  }
}
