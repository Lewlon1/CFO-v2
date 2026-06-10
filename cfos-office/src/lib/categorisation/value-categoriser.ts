import type { Category, ValueCategoryRule } from '@/lib/parsers/types'
import { normaliseMerchant } from './normalise-merchant'
import {
  CATEGORY_AMBIGUITY,
  timeOfDayMultiplier,
  type ContextualSignals,
} from './context-signals'
import { getTimeContext } from '@/lib/utils/time-context'
import { matchValueRule, type RuleMatchType } from './value-rule-matcher'
import {
  emittableDefaultCategory,
  gateDefaultEmission,
} from './value-config'

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
 * 2. User rules — delegated to the shared matcher (value-rule-matcher.ts,
 *    VM-2): merchant_time > merchant_amount > merchant > category_time >
 *    category_amount > category > global, exact normalised-merchant equality,
 *    RULE_APPLICATION_MIN_CONFIDENCE floor.
 * 3. Category default + ambiguity discount
 * 4. Fallback → 'unsure', confidence 0
 *
 * When `signals` is omitted (preview, backwards compat), tier 1 and
 * contextual adjustments in tier 3 are skipped gracefully, and time-context
 * rules can't match (no usable timestamp).
 */
export function assignValueCategory(
  description: string,
  categoryId: string | null,
  userRules: ValueCategoryRule[],
  categories: Category[],
  signals?: ContextualSignals,
  amount?: number
): ValueCatResult {
  // Transfers are internal money movement — not spending. Skip value assignment.
  if (categoryId === 'transfers') {
    return { valueCategory: 'unsure', confidence: 0, source: 'none' }
  }

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
  // Only foundation/burden/investment defaults qualify — a 'leak' default
  // must never be auto-asserted, recurring or not (VM-1).
  const recurringDefault = emittableDefaultCategory(category?.default_value_category)
  if (signals?.is_recurring && ambiguity === 'low' && recurringDefault) {
    return {
      valueCategory: recurringDefault,
      confidence: 0.9,
      source: 'recurring_essential',
    }
  }

  // ── Tier 2: User rules via the shared matcher (VM-2) ───────────────
  const match = matchValueRule(
    {
      description,
      merchantClean: normalised,
      categoryId,
      amount: amount ?? 0,
      timeContext: txnTimeContext,
    },
    userRules
  )
  if (match) {
    return {
      valueCategory: match.valueCategory,
      confidence: match.confidence,
      source: RULE_SOURCE_LABEL[match.matchType],
    }
  }

  // ── Tier 3: Category default + ambiguity discount ──────────────────
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

    // VM-1 gate: defaults never emit 'leak' (→ unsure @ 0.1) and are capped
    // at DEFAULT_SOURCE_CONFIDENCE_CAP — a category lookup is a weak prior,
    // not evidence.
    const gated = gateDefaultEmission(
      category.default_value_category,
      Math.round(adjusted * 100) / 100
    )
    return {
      valueCategory: gated.valueCategory,
      confidence: gated.confidence,
      source: 'category_default',
    }
  }

  // ── Tier 4: Fallback ───────────────────────────────────────────────
  return { valueCategory: 'unsure', confidence: 0, source: 'none' }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** ValueCatResult source label for each shared-matcher tier. */
const RULE_SOURCE_LABEL: Record<RuleMatchType, ValueCatResult['source']> = {
  merchant_time: 'user_merchant_time_rule',
  merchant_amount: 'user_merchant_amount_rule',
  merchant: 'user_merchant_rule',
  category_time: 'user_category_time_rule',
  category_amount: 'user_category_amount_rule',
  category: 'user_category_rule',
  global: 'user_global_rule',
}
