export type ValueCategoryType = 'foundation' | 'investment' | 'leak' | 'burden' | 'unsure'

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

/** Supabase upsert onConflict string for value_category_rules unique index.
 *  Repaired by migration 064_vcr_unique_index_repair: time_context is now
 *  NOT NULL DEFAULT '__none__' and the unique index is on plain columns. */
export const VCR_ON_CONFLICT = 'user_id,match_type,match_value,time_context'

/** Sentinel stored in value_category_rules.time_context for rules with no time
 *  context (plain merchant / category / global rules). Migration 064 set the
 *  column NOT NULL DEFAULT '__none__'; PostgREST only applies that default when
 *  the field is OMITTED, so any path that passes an explicit value must use this
 *  sentinel rather than null — both when writing and when matching on read. */
export const NONE_TIME_CONTEXT = '__none__'
