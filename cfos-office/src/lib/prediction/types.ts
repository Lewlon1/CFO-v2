export type ValueCategoryType = 'foundation' | 'investment' | 'leak' | 'burden' | 'no_idea'

/** A correction signal row as queried from the DB */
export type CorrectionSignal = {
  value_category: ValueCategoryType
  amount: number
  time_context: string
  weight_multiplier: number
  created_at: string
  category_id: string | null
}

/** A computed rule candidate ready for upsert */
export type RuleCandidate = {
  match_type: string
  match_value: string
  value_category: ValueCategoryType
  confidence: number
  total_signals: number
  agreement_ratio: number
  avg_amount_low: number | null
  avg_amount_high: number | null
  time_context: string | null
  source: 'learned'
}

/** Result from the prediction function */
export type PredictionResult = {
  value_category: ValueCategoryType | null
  confidence: number
  source: string
}

/** Supabase upsert onConflict string for value_category_rules unique index */
export const VCR_ON_CONFLICT = "user_id,match_type,match_value,coalesce(time_context,'__none__')"
