export type ParsedTransactionSource =
  | 'csv_revolut'
  | 'csv_santander'
  | 'csv_generic'
  | 'screenshot'

export type ParsedTransaction = {
  date: string            // ISO 8601 — "YYYY-MM-DDTHH:mm:ssZ" when source has time, else "YYYY-MM-DDT00:00:00Z"
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
  suggestedValueConfidence: number
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

// Contextual conditions for when a value category rule applies.
// null means "match in any context" (unconditional).
export type ContextConditions = {
  hour_range?: { from: number; to: number } // 0–23, wraps midnight (e.g. {from:22,to:5})
  day_type?: 'weekday' | 'weekend' | 'friday_evening'
  amount_range?: { min?: number; max?: number }
} | null

// Value category rule loaded from value_category_rules
export type ValueCategoryRule = {
  match_type: string
  match_value: string
  value_category: string
  confidence: number
  source: string
  context_conditions: ContextConditions
}

// User-learned traditional category rule from corrections
export type UserMerchantRule = {
  normalised_merchant: string
  category_id: string
  confidence: number
}

// Recurring expense match data for category inheritance
export type RecurringMatch = {
  name: string          // normalised merchant name
  category_id: string | null
}
