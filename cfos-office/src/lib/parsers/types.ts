// Source tag on every ParsedTransaction. The universal refactor
// collapses the per-bank variants into `csv_universal`; old DB rows
// still carry the deleted tags (e.g. `csv_revolut`) — downstream
// consumers must tolerate unknown strings (ImportHistory already
// uses Record<string,string>).
export type ParsedTransactionSource =
  | 'csv_universal'
  | 'pdf_vision'
  | 'ofx'
  | 'qif'
  | 'screenshot'
  | 'pdf_statement'

export type ParsedTransaction = {
  date: string            // ISO 8601 — "YYYY-MM-DDTHH:mm:ssZ" when source has time, else "YYYY-MM-DDT00:00:00Z"
  description: string     // cleaned, trimmed
  amount: number          // SIGNED: negative = expense, positive = income
  currency: string        // ISO 4217 e.g. 'EUR', 'GBP'
  source: ParsedTransactionSource
  raw_description: string // original text before cleaning
  // Running balance after this transaction, when the source export provides it
  // (Revolut: `Balance`, Santander: `Saldo`). Null when missing or unparseable.
  // Consumed by the balance_trajectory detector.
  balance?: number | null
}

export type ParseResult =
  | { ok: true; transactions: ParsedTransaction[] }
  | { ok: false; error: string }

// ── Universal parser (Session A) ────────────────────────────────────
// Types for the single-pipeline parser that replaces the per-bank
// branching. Every parser in this family emits ParsedTransaction with
// the signed-amount invariant: debits negative, credits positive.

export type FileType = 'csv' | 'pdf' | 'ofx' | 'qif' | 'xlsx' | 'image'

export type SignConvention =
  // amount column is already signed (Revolut, Starling, Barclays, HSBC)
  | 'signed_single_column'
  // separate credit + debit columns, both positive (Monzo Money In/Out)
  | 'split_in_out'
  // magnitude in one column, sign derived from a DR/CR-style flag column
  | 'type_flag'

// 1,234.56 (UK/US) vs 1.234,56 (ES/DE/FR). Drives parseAmount().
export type DecimalFormat = 'dot' | 'comma'

export type FormatTemplateColumnMapping = {
  date: string
  description: string
  amount?: string
  debit?: string
  credit?: string
  type_flag?: string
  // When sign_convention === 'type_flag', these string values tell the
  // parser which flag means debit vs credit (e.g. { debit: 'DR', credit: 'CR' }).
  type_flag_values?: { debit: string; credit: string }
  currency?: string
  balance?: string
}

export type FormatTemplate = {
  id?: string
  headerHash: string
  bankName: string | null
  fileType: FileType
  columnMapping: FormatTemplateColumnMapping
  signConvention: SignConvention
  // 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'ISO' | other explicit token
  dateFormat: string
  decimalFormat: DecimalFormat
  currencyDefault: string
  sampleHeaders: string
  detectionSource: 'llm' | 'manual' | 'user_confirmed'
  useCount?: number
}

// Spec-facing alias. The universal parser's output IS a ParsedTransaction —
// the signed-amount contract is already encoded there (see the comment on
// ParsedTransaction.amount above). Callers can use either name.
export type NormalisedTransaction = ParsedTransaction

// Universal parser result — extends ParseResult with warnings and
// a skippedRows counter so the UI can surface partial failures.
export type StatementMetadata = {
  openingBalance: number | null
  closingBalance: number | null
  statementPeriodStart: string | null  // ISO date
  statementPeriodEnd: string | null    // ISO date
  accountCurrency: string | null       // ISO 4217
}

export type UniversalParseResult =
  | {
      ok: true
      transactions: ParsedTransaction[]
      template: FormatTemplate
      skippedRows: number
      warnings: string[]
      // Only populated by the PDF vision path today. CSV/XLSX may
      // surface this in future if the detect-format prompt is extended
      // to extract period + balances from header rows.
      statementMetadata?: StatementMetadata | null
    }
  | { ok: false; error: string; warnings?: string[] }

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
