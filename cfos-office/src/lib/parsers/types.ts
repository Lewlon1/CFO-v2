export type ParsedTransactionSource =
  | 'csv_revolut'
  | 'csv_santander'
  | 'csv_generic'
  | 'screenshot'

export type ParsedTransaction = {
  date: string            // ISO YYYY-MM-DD
  description: string     // cleaned, trimmed
  amount: number          // SIGNED: negative = expense, positive = income
  currency: string        // ISO 4217 e.g. 'EUR', 'GBP'
  source: ParsedTransactionSource
  raw_description: string // original text before cleaning
}

export type ParseResult =
  | { ok: true; transactions: ParsedTransaction[] }
  | { ok: false; error: string }

// Returned from the /api/upload parse step — includes duplicate flags
export type PreviewTransaction = ParsedTransaction & {
  suggestedCategoryId: string | null
  suggestedValueCategory: string
  isDuplicate: boolean
  rowIndex: number
}

// Category shape loaded from Supabase categories table
export type Category = {
  id: string
  name: string
  tier: 'core' | 'lifestyle' | 'financial'
  icon: string
  color: string
  description?: string | null
  examples: string[]
  default_value_category: string | null
}

// Value category rule loaded from value_category_rules
export type ValueCategoryRule = {
  match_type: string
  match_value: string
  value_category: string
  confidence: number
  source: string
}
