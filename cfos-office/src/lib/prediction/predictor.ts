import type { SupabaseClient } from '@supabase/supabase-js'
import type { ValueCategoryRule, Category } from '@/lib/parsers/types'
import { gateDefaultEmission } from '@/lib/categorisation/value-config'
import { matchValueRule } from '@/lib/categorisation/value-rule-matcher'
import type { PredictionResult, ValueCategoryType } from './types'

/**
 * Pure resolution function — no DB access.
 * Takes pre-loaded rules and categories. Rule resolution is delegated to the
 * shared matcher (categorisation/value-rule-matcher.ts — VM-2); this module
 * only adds the gated category-default fallback below it.
 * Use this for batch operations (import pipeline, re-score).
 */
export function resolveValueCategory(
  rules: ValueCategoryRule[],
  categories: Category[],
  merchantClean: string,
  categoryId: string | null,
  amount: number,
  transactionTime: Date
): PredictionResult {
  const match = matchValueRule(
    { description: '', merchantClean, categoryId, amount, date: transactionTime },
    rules
  )
  if (match) {
    return {
      value_category: match.valueCategory as ValueCategoryType,
      confidence: match.confidence,
      source: match.matchType,
    }
  }

  // Category default — gated (VM-1): never emits 'leak', confidence capped at
  // DEFAULT_SOURCE_CONFIDENCE_CAP.
  if (categoryId) {
    const cat = categories.find((c) => c.id === categoryId)
    if (cat?.default_value_category) {
      const gated = gateDefaultEmission(cat.default_value_category, 0.15)
      return {
        value_category: gated.valueCategory,
        confidence: gated.confidence,
        source: 'category_default',
      }
    }
  }

  return { value_category: null, confidence: 0, source: 'none' }
}

/**
 * Load all value_category_rules for a user.
 * Call once at the start of a batch operation, pass result to resolveValueCategory.
 */
export async function loadUserRules(
  supabase: SupabaseClient,
  userId: string
): Promise<ValueCategoryRule[]> {
  const { data } = await supabase
    .from('value_category_rules')
    .select('id, match_type, match_value, value_category, confidence, total_signals, agreement_ratio, avg_amount_low, avg_amount_high, time_context, source, last_signal_at')
    .eq('user_id', userId)

  return (data ?? []) as ValueCategoryRule[]
}
