import type { SupabaseClient } from '@supabase/supabase-js'
import type { ValueCategoryRule, Category } from '@/lib/parsers/types'
import { getTimeContext } from '@/lib/utils/time-context'
import type { PredictionResult, ValueCategoryType } from './types'

/** Confidence thresholds per tier — a rule must meet this to be used */
const THRESHOLDS: Record<string, number> = {
  merchant_time: 0.30,
  merchant_amount: 0.30,
  merchant: 0.25,
  category_time: 0.20,
  category_amount: 0.20,
  category: 0.15,
  global: 0, // always returns if exists
}

/** Resolution order — first match above threshold wins */
const RESOLUTION_ORDER = [
  'merchant_time',
  'merchant_amount',
  'merchant',
  'category_time',
  'category_amount',
  'category',
  'global',
] as const

function daysSince(dateStr: string | null): number {
  if (!dateStr) return Infinity
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function recencyBoost(lastSignalAt: string | null): number {
  const days = daysSince(lastSignalAt)
  return Math.max(0, 0.05 * (1 - days / 90))
}

function findRule(
  rules: ValueCategoryRule[],
  matchType: string,
  matchValue: string,
  timeContext: string | null
): ValueCategoryRule | undefined {
  return rules.find((r) => {
    if (r.match_type !== matchType) return false
    if (r.match_value !== matchValue) return false
    if (matchType.endsWith('_time')) return r.time_context === timeContext
    if (matchType.endsWith('_amount')) return true // amount checked separately
    return r.time_context === null || r.time_context === undefined
  })
}

function findAmountRule(
  rules: ValueCategoryRule[],
  matchType: string,
  matchValue: string,
  amount: number
): ValueCategoryRule | undefined {
  const abs = Math.abs(amount)
  return rules.find((r) => {
    if (r.match_type !== matchType || r.match_value !== matchValue) return false
    if (r.avg_amount_low !== null && abs < r.avg_amount_low) return false
    if (r.avg_amount_high !== null && abs > r.avg_amount_high) return false
    return true
  })
}

/**
 * Pure resolution function — no DB access.
 * Takes pre-loaded rules and categories, resolves value category through 9 tiers.
 * Use this for batch operations (import pipeline).
 */
export function resolveValueCategory(
  rules: ValueCategoryRule[],
  categories: Category[],
  merchantClean: string,
  categoryId: string | null,
  amount: number,
  transactionTime: Date
): PredictionResult {
  const timeContext = getTimeContext(transactionTime)

  for (const tier of RESOLUTION_ORDER) {
    let rule: ValueCategoryRule | undefined
    if (tier === 'global') {
      rule = rules.find((r) => r.match_type === 'global')
    } else {
      // Determine match_value based on tier type
      const isMerchantTier = tier.startsWith('merchant')
      const matchValue = isMerchantTier ? merchantClean : (categoryId ?? '')
      if (!matchValue) continue

      if (tier.endsWith('_amount')) {
        rule = findAmountRule(rules, tier, matchValue, amount)
      } else if (tier.endsWith('_time')) {
        rule = findRule(rules, tier, matchValue, timeContext)
      } else {
        rule = findRule(rules, tier, matchValue, null)
      }
    }

    if (!rule) continue

    // Threshold check uses raw confidence (before recency boost)
    if (rule.confidence < (THRESHOLDS[tier] ?? 0)) continue

    const boost = recencyBoost(rule.last_signal_at ?? null)
    const finalConfidence = Math.round(Math.min(0.99, rule.confidence + boost) * 100) / 100

    return {
      value_category: rule.value_category as ValueCategoryType,
      confidence: finalConfidence,
      source: tier,
    }
  }

  // Tier 8: category default
  if (categoryId) {
    const cat = categories.find((c) => c.id === categoryId)
    if (cat?.default_value_category) {
      return {
        value_category: cat.default_value_category as ValueCategoryType,
        confidence: 0.15,
        source: 'category_default',
      }
    }
  }

  // Tier 9: null
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

/**
 * Convenience wrapper — loads rules from DB, then resolves.
 * Use for single predictions (e.g. backfill). For batch, use loadUserRules + resolveValueCategory.
 */
export async function predictValueCategory(
  supabase: SupabaseClient,
  userId: string,
  merchantClean: string,
  categoryId: string | null,
  amount: number,
  transactionTime: Date
): Promise<PredictionResult> {
  const [rules, { data: catData }] = await Promise.all([
    loadUserRules(supabase, userId),
    supabase.from('categories').select('id, name, tier, icon, color, examples, default_value_category').eq('is_active', true),
  ])
  const categories = (catData ?? []) as Category[]
  return resolveValueCategory(rules, categories, merchantClean, categoryId, amount, transactionTime)
}
