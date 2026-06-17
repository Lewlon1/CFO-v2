// VM-5 — the Alignment Score. "Does your spending match what you say
// matters" as one deterministic, versioned number. Pure arithmetic — no LLM
// touches this; C. cites the stored result verbatim via the context builder.
//
// FORMULA VERSIONING DISCIPLINE (same as the archetype taxonomy): the v1
// formula below is pinned. It is never edited in place — a change is a NEW
// version, and every snapshot stores the version it was computed under so
// populations stay comparable.
//
// The display gate (ALIGNMENT_DISPLAY_MIN_CONFIDENCE) lives in
// lib/categorisation/value-config.ts with the rest of the VM-1 honesty-gate
// thresholds — no surface defines its own floor.

import {
  isValueDisplayable,
  UNMAPPED_BUCKET,
} from '@/lib/categorisation/value-config'
import { INCOME_CATEGORY_ID, isNeutralCategory } from '@/lib/analytics/categories'

export const ALIGNMENT_VERSION = 'v1' as const

export interface AlignmentResult {
  /** (foundation + investment) / (foundation + investment + leak), as a
   *  percentage 0–100 rounded to 4 dp. Null when the denominator is 0 —
   *  no displayable foundation/investment/leak spend means no score, never
   *  a fake 0 or 100. */
  alignedSpendPct: number | null
  /** displayable spend / eligible spend, 0–1 rounded to 4 dp. The honesty
   *  measure: how much of the month's real spending carries a value label
   *  the VM-1 gate lets us assert. 0 when there is no eligible spend. */
  alignmentConfidence: number
  version: typeof ALIGNMENT_VERSION
  /** Money components (2 dp), for reconciliation and debugging. Burden is
   *  reported here but EXCLUDED from the ratio — necessary costs are not
   *  judged. */
  components: {
    aligned: number
    leak: number
    burden: number
    displayable: number
    eligible: number
  }
}

/** The transaction fields the v1 formula reads. Deleted rows must be
 *  excluded by the caller's query — soft-deletion is a storage concern,
 *  not a formula input. */
export type EligibleTxn = {
  amount: number | string
  category_id: string | null
  value_category: string | null
  value_confidence: number | null
  value_confirmed_by_user: boolean | null
}

const round4 = (n: number) => Math.round(n * 10000) / 10000
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * v1 FORMULA (pinned) over a month's value buckets — the same
 * spending_by_value_category shape the snapshot writer persists:
 *
 *   displayable buckets = foundation, investment, leak, burden
 *                         (anything else — 'unmapped', legacy 'unsure' /
 *                         'no_idea' — is eligible but not displayable)
 *   each bucket clamps at 0 (a refund-heavy bucket can't subtract from the
 *   others — mirrors the totalSpending clamp in aggregateMonthSpending)
 *   alignedSpendPct     = (foundation + investment)
 *                         / (foundation + investment + leak); null if denom 0
 *   alignmentConfidence = displayable / eligible; 0 if eligible is 0
 *   burden              = in components and in confidence, NOT in the ratio
 *
 * Deriving from the bucket record keeps the score provably consistent with
 * the snapshot jsonb and every surface already rendering it (the unmapped €
 * a user sees IS the gap between confidence and 1).
 */
export function alignmentFromValueBuckets(
  buckets: Record<string, number> | null | undefined,
): AlignmentResult {
  let foundation = 0
  let investment = 0
  let leak = 0
  let burden = 0
  let nonDisplayable = 0

  for (const [key, raw] of Object.entries(buckets ?? {})) {
    const clamped = Math.max(Number(raw) || 0, 0)
    if (key === 'foundation') foundation = clamped
    else if (key === 'investment') investment = clamped
    else if (key === 'leak') leak = clamped
    else if (key === 'burden') burden = clamped
    else nonDisplayable += clamped
  }

  const aligned = foundation + investment
  const displayable = aligned + leak + burden
  const eligible = displayable + nonDisplayable
  const ratioDenom = aligned + leak

  return {
    alignedSpendPct: ratioDenom > 0 ? round4((aligned / ratioDenom) * 100) : null,
    alignmentConfidence: eligible > 0 ? round4(displayable / eligible) : 0,
    version: ALIGNMENT_VERSION,
    components: {
      aligned: round2(aligned),
      leak: round2(leak),
      burden: round2(burden),
      displayable: round2(displayable),
      eligible: round2(eligible),
    },
  }
}

/**
 * v1 formula over raw transactions. Eligibility mirrors
 * aggregateMonthSpending (lib/analytics/monthly-snapshot.ts) exactly —
 * income rows out, neutral categories (transfers / debt / savings) out,
 * stray positive null-category inflows out, net deltas (outflow positive,
 * refund negative), VM-1 displayability gate per row. The equivalence is
 * pinned by a unit test so the two paths cannot drift.
 */
export function computeAlignment(txns: readonly EligibleTxn[]): AlignmentResult {
  const buckets: Record<string, number> = {}
  for (const txn of txns) {
    if (txn.category_id === INCOME_CATEGORY_ID) continue
    if (isNeutralCategory(txn.category_id)) continue
    if (Number(txn.amount) > 0 && !txn.category_id) continue
    const vc = isValueDisplayable(txn)
      ? (txn.value_category as string)
      : UNMAPPED_BUCKET
    buckets[vc] = (buckets[vc] ?? 0) + -Number(txn.amount)
  }
  return alignmentFromValueBuckets(buckets)
}
