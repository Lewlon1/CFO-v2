import type { ValueCategoryRule } from '@/lib/parsers/types'
import { getTimeContext } from '@/lib/utils/time-context'
import { NONE_TIME_CONTEXT } from '@/lib/prediction/types'
import { normaliseMerchant } from './normalise-merchant'
import { RULE_APPLICATION_MIN_CONFIDENCE, type ValueCategory } from './value-config'

/**
 * VM-2 — the single shared value-rule matcher.
 *
 * Every surface that applies `value_category_rules` to a transaction —
 * import pipeline, upload preview, retroactive re-score, backfill — resolves
 * through this function, so rule semantics and merchant normalisation can
 * never drift between ingest and re-score. The category-default fallback is
 * NOT here: this module answers "does a user rule speak to this transaction",
 * nothing more.
 *
 * Semantics (carried over from prediction/predictor.ts, the previous resolver):
 * - Specificity order: merchant_time > merchant_amount > merchant >
 *   category_time > category_amount > category > global. First tier with an
 *   eligible rule wins; within a tier, highest confidence wins.
 * - Merchant tiers match on exact equality with normaliseMerchant output —
 *   the same normaliser the category pipeline and every rule writer use.
 * - Amount bands are inclusive: avg_amount_low ≤ |amount| ≤ avg_amount_high,
 *   a null bound is open (writer semantics: learning-engine computeAmountRules
 *   splits at the band midpoint, low band gets avg_amount_high, high band gets
 *   avg_amount_low).
 * - Plain (non-time) rules store time_context '__none__' (migration 064);
 *   legacy null/undefined is accepted.
 * - A rule is eligible only when its raw confidence (pre recency boost) is at
 *   least RULE_APPLICATION_MIN_CONFIDENCE. This single floor supersedes the
 *   old per-tier thresholds (0.15–0.30), all of which sat below it.
 * - The returned confidence carries the recency boost: up to +0.05 for a rule
 *   signalled today, decaying linearly to zero at 90 days, capped at 0.99.
 */

export type RuleMatchType =
  | 'merchant_time'
  | 'merchant_amount'
  | 'merchant'
  | 'category_time'
  | 'category_amount'
  | 'category'
  | 'global'

export interface RuleMatch {
  /** value_category_rules.id when the row carried one (DB loads do). */
  ruleId: string | null
  valueCategory: ValueCategory
  /** Rule confidence with recency boost applied, capped at 0.99. */
  confidence: number
  matchType: RuleMatchType
}

export interface TxnLike {
  description: string
  categoryId: string | null
  amount: number
  /** Used to derive the time-context bucket when `timeContext` is not given. */
  date?: Date | string
  /** Precomputed normaliseMerchant(description) — pass in batch loops. */
  merchantClean?: string
  /** Explicit time bucket (overrides derivation from `date`). Pass null to
   *  skip time-context tiers when no usable timestamp exists. */
  timeContext?: string | null
}

/** prediction_source column value for each rule tier. */
export const RULE_MATCH_PREDICTION_SOURCE: Record<RuleMatchType, string> = {
  merchant_time: 'merchant_rule',
  merchant_amount: 'merchant_rule',
  merchant: 'merchant_rule',
  category_time: 'category_rule',
  category_amount: 'category_rule',
  category: 'category_rule',
  global: 'global_rule',
}

/** Resolution order — first tier with an eligible match wins. */
const RESOLUTION_ORDER: RuleMatchType[] = [
  'merchant_time',
  'merchant_amount',
  'merchant',
  'category_time',
  'category_amount',
  'category',
  'global',
]

function daysSince(dateStr: string | null): number {
  if (!dateStr) return Infinity
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function recencyBoost(lastSignalAt: string | null): number {
  const days = daysSince(lastSignalAt)
  return Math.max(0, 0.05 * (1 - days / 90))
}

function hasNoTimeContext(r: ValueCategoryRule): boolean {
  return (
    r.time_context === NONE_TIME_CONTEXT ||
    r.time_context === null ||
    r.time_context === undefined
  )
}

function inAmountBand(r: ValueCategoryRule, amount: number): boolean {
  const abs = Math.abs(amount)
  if (r.avg_amount_low !== null && abs < r.avg_amount_low) return false
  if (r.avg_amount_high !== null && abs > r.avg_amount_high) return false
  return true
}

/**
 * Resolve the single winning rule for a transaction, or null when no rule at
 * or above RULE_APPLICATION_MIN_CONFIDENCE speaks to it. Pure — no I/O.
 *
 * Rules MAY emit 'leak' — unlike category defaults. Rules are user evidence;
 * leak-by-evidence is the design. Callers enforce the sacred precedence
 * themselves: rows with value_confirmed_by_user = true are never touched.
 */
export function matchValueRule(txn: TxnLike, rules: ValueCategoryRule[]): RuleMatch | null {
  const merchantClean = txn.merchantClean ?? normaliseMerchant(txn.description)
  const timeContext =
    txn.timeContext !== undefined
      ? txn.timeContext
      : txn.date !== undefined
        ? getTimeContext(new Date(txn.date))
        : null

  for (const tier of RESOLUTION_ORDER) {
    let candidates: ValueCategoryRule[]

    if (tier === 'global') {
      candidates = rules.filter((r) => r.match_type === 'global')
    } else {
      const matchValue = tier.startsWith('merchant') ? merchantClean : (txn.categoryId ?? '')
      if (!matchValue) continue

      candidates = rules.filter((r) => {
        if (r.match_type !== tier || r.match_value !== matchValue) return false
        if (tier.endsWith('_time')) return timeContext !== null && r.time_context === timeContext
        if (tier.endsWith('_amount')) return inAmountBand(r, txn.amount)
        return hasNoTimeContext(r)
      })
    }

    // Application floor is checked on raw confidence, before the boost.
    let best: ValueCategoryRule | null = null
    for (const r of candidates) {
      if (r.confidence < RULE_APPLICATION_MIN_CONFIDENCE) continue
      if (!best || r.confidence > best.confidence) best = r
    }
    if (!best) continue

    const boosted =
      Math.round(Math.min(0.99, best.confidence + recencyBoost(best.last_signal_at ?? null)) * 100) / 100

    return {
      ruleId: best.id ?? null,
      valueCategory: best.value_category as ValueCategory,
      confidence: boosted,
      matchType: tier,
    }
  }

  return null
}
