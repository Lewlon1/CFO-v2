/**
 * VM-1 — Value honesty gate. Single source of truth for value-category
 * display gating and default-emission rules. No component or write path
 * defines its own threshold; everything imports from here.
 */

/** Minimum confidence for an unconfirmed value label to render anywhere. */
export const VALUE_DISPLAY_CONFIDENCE_THRESHOLD = 0.6

/** Minimum raw rule confidence (pre recency boost) for a value_category_rules
 *  row to be applied to a transaction — at ingest, at re-score, and in the
 *  backfill. Below this a rule is "still learning": it keeps accumulating
 *  signals but asserts nothing. VM-2, provisional. */
export const RULE_APPLICATION_MIN_CONFIDENCE = 0.5

/** The "confident enough to cite/assert a value verdict in chat" line. Chat
 *  tools and prompt-context builders treat an unconfirmed value label below
 *  this as unsorted, never asserting it as Foundation/.../Leak. (VM-1
 *  follow-up: previously hardcoded as 0.7 in each tool.) */
export const VALUE_CHAT_CITATION_THRESHOLD = 0.7

/** Ceiling for any value_confidence written by a category default. */
export const DEFAULT_SOURCE_CONFIDENCE_CAP = 0.3

/** Confidence written when a default emission is suppressed to 'unsure'. */
export const SUPPRESSED_DEFAULT_CONFIDENCE = 0.1

/** Bucket key for non-displayable spend in spending_by_value_category. */
export const UNMAPPED_BUCKET = 'unmapped'

/** 'no_idea' is retired — collapsed into 'unsure'. The Postgres enum value
 *  remains (non-destructive) but MUST never be written again. */
export type ValueCategory = 'foundation' | 'burden' | 'investment' | 'leak' | 'unsure'

const SUBSTANTIVE_VALUE_CATEGORIES: ReadonlySet<string> = new Set([
  'foundation',
  'burden',
  'investment',
  'leak',
])

/**
 * Should this transaction's value label render as a real category?
 * False → render the neutral "Unmapped" chip instead.
 *
 * User-confirmed labels always render. Unconfirmed labels render only at or
 * above VALUE_DISPLAY_CONFIDENCE_THRESHOLD. 'unsure' (and legacy 'no_idea')
 * never render as a value label regardless of confidence.
 */
export function isValueDisplayable(t: {
  value_category: string | null
  value_confidence: number | null
  value_confirmed_by_user: boolean | null
}): boolean {
  if (!t.value_category || !SUBSTANTIVE_VALUE_CATEGORIES.has(t.value_category)) return false
  if (t.value_confirmed_by_user) return true
  return (t.value_confidence ?? 0) >= VALUE_DISPLAY_CONFIDENCE_THRESHOLD
}

/**
 * A category default may seed foundation / burden / investment. It may NEVER
 * seed 'leak' — calling a spend wasteful is a moral judgement that requires
 * user signal, not a category lookup. Returns null for 'leak', retired values
 * ('no_idea'), 'unsure', or anything unknown.
 */
export function emittableDefaultCategory(
  defaultValueCategory: string | null | undefined
): Exclude<ValueCategory, 'unsure' | 'leak'> | null {
  if (
    defaultValueCategory === 'foundation' ||
    defaultValueCategory === 'burden' ||
    defaultValueCategory === 'investment'
  ) {
    return defaultValueCategory
  }
  return null
}

/**
 * Gate a category-default emission: emittable defaults pass through capped at
 * DEFAULT_SOURCE_CONFIDENCE_CAP; everything else is suppressed to
 * { unsure, 0.1 }.
 */
export function gateDefaultEmission(
  defaultValueCategory: string | null | undefined,
  confidence: number
): { valueCategory: ValueCategory; confidence: number } {
  const emittable = emittableDefaultCategory(defaultValueCategory)
  if (!emittable) {
    return { valueCategory: 'unsure', confidence: SUPPRESSED_DEFAULT_CONFIDENCE }
  }
  return {
    valueCategory: emittable,
    confidence: Math.min(confidence, DEFAULT_SOURCE_CONFIDENCE_CAP),
  }
}
