export type ParsedTransactionSource =
  | 'csv_revolut'
  | 'csv_santander'
  | 'csv_monzo'
  | 'csv_starling'
  | 'csv_hsbc'
  | 'csv_barclays'
  | 'csv_generic'
  | 'screenshot'
  | 'pdf_statement'

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

// Value category rule match types (Session 28 — new schema)
export type ValueRuleMatchType =
  | 'merchant'         // exact normalised merchant
  | 'merchant_time'    // merchant + time_context bucket
  | 'merchant_amount'  // merchant + amount band
  | 'category'         // traditional category fallback
  | 'category_time'    // category + time_context bucket
  | 'category_amount'  // category + amount band
  | 'global'           // user-wide prior

// Value category rule loaded from value_category_rules
export type ValueCategoryRule = {
  id?: string
  match_type: ValueRuleMatchType
  match_value: string
  value_category: string
  confidence: number
  total_signals: number
  agreement_ratio: number
  avg_amount_low: number | null
  avg_amount_high: number | null
  time_context: string | null
  source: string
  last_signal_at: string | null
}

// ── Balance sheet parsing (Session 19B) ──────────────────────────────
// A single row from a holdings/portfolio CSV, post-parsing but pre-save.
// Consumed by the HoldingsPreview component and, on confirm, turned into
// investment_holdings rows under a parent `assets` row.
export type ParsedHolding = {
  ticker: string | null
  name: string
  quantity: number | null
  current_value: number | null
  cost_basis: number | null
  price_per_unit: number | null
  gain_loss_pct: number | null
  currency: string
  asset_type_hint: string | null
  raw_row: Record<string, string>
}

export type HoldingsParseResult =
  | {
      ok: true
      holdings: ParsedHolding[]
      suggestedAssetName: string | null
      suggestedProvider: string | null
    }
  | { ok: false; error: string }

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
