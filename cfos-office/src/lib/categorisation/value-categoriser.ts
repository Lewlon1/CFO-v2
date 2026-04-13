import type { Category, ValueCategoryRule } from '@/lib/parsers/types'
import { normaliseMerchant } from './normalise-merchant'
import {
  CATEGORY_AMBIGUITY,
  timeOfDayMultiplier,
  type ContextualSignals,
} from './context-signals'
import { getTimeContext } from '@/lib/utils/time-context'

export type ValueCatResult = {
  valueCategory: string
  confidence: number
  source:
    | 'recurring_essential'
    | 'user_merchant_time_rule'
    | 'user_merchant_amount_rule'
    | 'user_merchant_rule'
    | 'user_category_time_rule'
    | 'user_category_amount_rule'
    | 'user_category_rule'
    | 'user_global_rule'
    | 'category_default'
    | 'none'
}

/**
 * Assign a value category using hierarchical rule matching:
 *
 * 1. Recurring essentials — recurring + low-ambiguity category → 0.9
 * 2. Merchant rules (most specific first):
 *    a. merchant_time — merchant + time_context match
 *    b. merchant_amount — merchant + amount band match
 *    c. merchant — plain merchant match
 * 3. Category rules (most specific first):
 *    a. category_time — category + time_context match
 *    b. category_amount — category + amount band match
 *    c. category — plain category match
 * 4. Global user prior
 * 5. Category default + ambiguity discount
 * 6. Fallback → 'no_idea', confidence 0
 *
 * When `signals` is omitted (preview, backwards compat), tier 1 and
 * contextual adjustments in tier 5 are skipped gracefully.
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

  // Derive time_context for matching time-based rules
  const txnTimeContext = signals
    ? getTimeContext(new Date(2024, 0, signals.is_weekend ? 6 : 1, signals.hour, signals.minute))
    : null

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

  // ── Tier 2: Merchant rules (most specific first) ───────────────────

  // 2a. merchant_time — match merchant + time_context
  if (txnTimeContext) {
    const rule = findRule(userRules, 'merchant_time', normalised, txnTimeContext)
    if (rule) {
      return {
        valueCategory: rule.value_category,
        confidence: rule.confidence,
        source: 'user_merchant_time_rule',
      }
    }
  }

  // 2b. merchant_amount — match merchant + amount in band
  if (amount !== undefined) {
    const rule = findAmountRule(userRules, 'merchant_amount', normalised, amount)
    if (rule) {
      return {
        valueCategory: rule.value_category,
        confidence: rule.confidence,
        source: 'user_merchant_amount_rule',
      }
    }
  }

  // 2c. merchant — plain merchant match
  {
    const rule = findRule(userRules, 'merchant', normalised, null)
    if (rule) {
      return {
        valueCategory: rule.value_category,
        confidence: rule.confidence,
        source: 'user_merchant_rule',
      }
    }
  }

  // ── Tier 3: Category rules ─────────────────────────────────────────
  if (categoryId) {
    // 3a. category_time
    if (txnTimeContext) {
      const rule = findRule(userRules, 'category_time', categoryId, txnTimeContext)
      if (rule) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_category_time_rule',
        }
      }
    }

    // 3b. category_amount
    if (amount !== undefined) {
      const rule = findAmountRule(userRules, 'category_amount', categoryId, amount)
      if (rule) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_category_amount_rule',
        }
      }
    }

    // 3c. category — plain
    {
      const rule = findRule(userRules, 'category', categoryId, null)
      if (rule) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_category_rule',
        }
      }
    }
  }

  // ── Tier 4: Global user prior ──────────────────────────────────────
  {
    const rule = userRules.find((r) => r.match_type === 'global')
    if (rule) {
      return {
        valueCategory: rule.value_category,
        confidence: rule.confidence,
        source: 'user_global_rule',
      }
    }
  }

  // ── Tier 5: Category default + ambiguity discount ──────────────────
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

  // ── Tier 6: Fallback ───────────────────────────────────────────────
  return { valueCategory: 'no_idea', confidence: 0, source: 'none' }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Find a rule by match_type + match_value, optionally filtering by time_context */
function findRule(
  rules: ValueCategoryRule[],
  matchType: string,
  matchValue: string,
  timeContext: string | null
): ValueCategoryRule | undefined {
  return rules.find((r) => {
    if (r.match_type !== matchType) return false
    // For merchant types, use includes (substring match) for backwards compat
    if (matchType.startsWith('merchant')) {
      if (!matchValue.includes(r.match_value.toLowerCase())) return false
    } else {
      if (r.match_value !== matchValue) return false
    }
    if (timeContext !== null) {
      return r.time_context === timeContext
    }
    return r.time_context === null || r.time_context === undefined
  })
}

/** Find an amount-band rule where the transaction amount falls within the rule's band */
function findAmountRule(
  rules: ValueCategoryRule[],
  matchType: string,
  matchValue: string,
  amount: number
): ValueCategoryRule | undefined {
  const abs = Math.abs(amount)
  return rules.find((r) => {
    if (r.match_type !== matchType) return false
    if (matchType.startsWith('merchant')) {
      if (!matchValue.includes(r.match_value.toLowerCase())) return false
    } else {
      if (r.match_value !== matchValue) return false
    }
    if (r.avg_amount_low !== null && abs < r.avg_amount_low) return false
    if (r.avg_amount_high !== null && abs > r.avg_amount_high) return false
    return true
  })
}
