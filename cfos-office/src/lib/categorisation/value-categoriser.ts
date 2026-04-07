import type { Category, ValueCategoryRule, ContextConditions } from '@/lib/parsers/types'
import { normaliseMerchant } from './normalise-merchant'
import {
  CATEGORY_AMBIGUITY,
  timeOfDayMultiplier,
  type ContextualSignals,
} from './context-signals'

export type ValueCatResult = {
  valueCategory: string
  confidence: number
  source:
    | 'recurring_essential'
    | 'user_contextual_rule'
    | 'user_description_rule'
    | 'user_category_rule'
    | 'category_default'
    | 'none'
}

/**
 * Assign a value category using 5-tier contextual scoring:
 *
 * 1. Recurring essentials — recurring + low-ambiguity category → 0.9
 * 2. User rules WITH context match — merchant match + context_conditions satisfied
 * 3. User rules WITHOUT context — legacy merchant_contains / category_id matching
 * 4. Category default + ambiguity discount — graduated contextual adjustments
 * 5. Fallback → 'unsure', confidence 0
 *
 * When `signals` is omitted (preview, backwards compat), tiers 1 and 4 contextual
 * adjustments are skipped; behaviour degrades gracefully to the old 3-tier logic.
 */
export function assignValueCategory(
  description: string,
  categoryId: string | null,
  userRules: ValueCategoryRule[],
  categories: Category[],
  signals?: ContextualSignals,
  amount?: number
): ValueCatResult {
  const normalised = normaliseMerchant(description)
  const category = categoryId
    ? categories.find((c) => c.id === categoryId)
    : undefined
  const ambiguity = categoryId
    ? (CATEGORY_AMBIGUITY[categoryId] ?? 'high')
    : 'high'

  // ── Tier 1: Recurring essentials (confidence 0.9) ──────────────────
  if (
    signals?.is_recurring &&
    ambiguity === 'low' &&
    category?.default_value_category
  ) {
    return {
      valueCategory: category.default_value_category,
      confidence: 0.9,
      source: 'recurring_essential',
    }
  }

  // ── Tier 2: User rules WITH context_conditions ─────────────────────
  // Only rules that have non-null context_conditions and match both
  // merchant AND context.
  if (signals) {
    for (const rule of userRules) {
      if (!rule.context_conditions) continue
      if (!matchesMerchant(rule, normalised, categoryId)) continue
      if (!matchesContext(rule.context_conditions, signals, amount)) continue
      return {
        valueCategory: rule.value_category,
        confidence: rule.confidence,
        source: 'user_contextual_rule',
      }
    }
  }

  // ── Tier 3: User rules WITHOUT context (legacy / unconditional) ────
  // Rules with null context_conditions — match merchant or category only.
  for (const rule of userRules) {
    if (rule.context_conditions) continue // already tried in tier 2
    if (rule.match_type === 'merchant_contains') {
      if (normalised.includes(rule.match_value.toLowerCase())) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_description_rule',
        }
      }
    }
  }
  if (categoryId) {
    for (const rule of userRules) {
      if (rule.context_conditions) continue
      if (rule.match_type === 'category_id' && rule.match_value === categoryId) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_category_rule',
        }
      }
    }
  }

  // ── Tier 4: Category default + ambiguity discount ──────────────────
  if (category?.default_value_category) {
    const baseConfidence =
      ambiguity === 'low' ? 0.6 : ambiguity === 'medium' ? 0.4 : 0.2

    let adjusted = baseConfidence

    if (signals) {
      // Time-of-day graduated adjustment (discretionary categories only)
      if (ambiguity !== 'low') {
        adjusted *= timeOfDayMultiplier(signals)
      }

      // High frequency same merchant same week
      if (signals.same_merchant_this_week >= 3) {
        adjusted *= 0.7
      }

      // Unusually high amount for this merchant
      if (signals.amount_vs_typical === 'high') {
        adjusted *= 0.8
      }
    }

    return {
      valueCategory: category.default_value_category,
      confidence: Math.round(adjusted * 100) / 100,
      source: 'category_default',
    }
  }

  // ── Tier 5: Fallback ───────────────────────────────────────────────
  return { valueCategory: 'unsure', confidence: 0, source: 'none' }
}

// ── Helpers ────────────────────────────────────────────────────────────

function matchesMerchant(
  rule: ValueCategoryRule,
  normalisedDesc: string,
  categoryId: string | null
): boolean {
  if (rule.match_type === 'merchant_contains') {
    return normalisedDesc.includes(rule.match_value.toLowerCase())
  }
  if (rule.match_type === 'category_id' && categoryId) {
    return rule.match_value === categoryId
  }
  return false
}

function matchesContext(
  conditions: NonNullable<ContextConditions>,
  signals: ContextualSignals,
  amount?: number
): boolean {
  // hour_range: supports midnight wrapping
  if (conditions.hour_range) {
    const { from, to } = conditions.hour_range
    const h = signals.hour
    if (from <= to) {
      // e.g. { from: 9, to: 17 } — simple range
      if (h < from || h > to) return false
    } else {
      // e.g. { from: 22, to: 5 } — wraps midnight
      if (h < from && h > to) return false
    }
  }

  // day_type
  if (conditions.day_type) {
    if (conditions.day_type === 'weekend' && !signals.is_weekend) return false
    if (conditions.day_type === 'weekday' && signals.is_weekend) return false
    if (
      conditions.day_type === 'friday_evening' &&
      !signals.is_friday_evening
    )
      return false
  }

  // amount_range
  if (conditions.amount_range && amount !== undefined) {
    const abs = Math.abs(amount)
    if (conditions.amount_range.min !== undefined && abs < conditions.amount_range.min)
      return false
    if (conditions.amount_range.max !== undefined && abs > conditions.amount_range.max)
      return false
  }

  return true
}
