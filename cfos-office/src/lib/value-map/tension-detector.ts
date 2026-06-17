// VM-4 — server-side tension detectors. Priority order, first hit wins:
//
//   D1  stated–observed mismatch  — the family the sorting over-indexed vs
//       the quadrant where the displayable value labels actually put the
//       money over the last three full calendar months (post-rescore).
//   D2  protected-but-shrinking   — a merchant the user just sorted
//       Foundation/Investment whose spend declined ≥20% across the window.
//   —   neither fires → the deterministic no-tension variant for the cell.
//
// Everything is computed from transaction rows; all rendered values are
// money facts (exact € and percentages allowed everywhere). Pure core
// (detectTension) is unit-testable; gatherTensionInputs does the I/O.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isValueDisplayable } from '@/lib/categorisation/value-config'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import {
  FAMILY_QUADRANT,
  QUADRANT_FAMILY,
  type ArchetypeFamily,
  type CertaintyState,
} from './taxonomy-config'
import {
  buildMismatchLine,
  buildShrinkingLine,
  buildNoTensionLine,
  type TensionLine,
} from './receipt-templates'
import type { ValueQuadrant } from './types'

export interface ProtectedMerchant {
  /** Normalised merchant key, as written to value_category_rules. */
  merchant: string
  quadrant: Extract<ValueQuadrant, 'foundation' | 'investment'>
}

export interface TensionTxnRow {
  description: string | null
  amount: number
  date: string
  value_category: string | null
  value_confidence: number | null
  value_confirmed_by_user: boolean | null
}

export interface TensionInputs {
  rows: TensionTxnRow[]
  protectedMerchants: ProtectedMerchant[]
  currency: string
  /** Injection point for tests; defaults to now. */
  today?: Date
}

const DISPLAYABLE_QUADRANTS = new Set<string>(['foundation', 'investment', 'burden', 'leak'])
/** D2 requires at least this much decline between the window's edge months. */
const SHRINK_THRESHOLD = 0.2

/** First day of the month `offset` months before the given date (UTC). */
function monthStart(today: Date, offset: number): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1))
  return d.toISOString().slice(0, 10)
}

export function detectTension(
  family: ArchetypeFamily,
  certainty: CertaintyState,
  inputs: TensionInputs,
): TensionLine {
  const today = inputs.today ?? new Date()
  // Window: the last three FULL calendar months (current partial month is
  // excluded — it would fake declines).
  const windowStart = monthStart(today, 3)
  const windowEnd = monthStart(today, 0)
  const earlyMonth = windowStart.slice(0, 7)
  const recentMonth = monthStart(today, 1).slice(0, 7)

  const inWindow = inputs.rows.filter(
    (r) => Number(r.amount) < 0 && r.date >= windowStart && r.date < windowEnd,
  )

  // ── D1: stated vs observed ────────────────────────────────────────────────
  const spendByQuadrant: Record<ValueQuadrant, number> = {
    foundation: 0,
    investment: 0,
    burden: 0,
    leak: 0,
  }
  let displayableTotal = 0
  for (const r of inWindow) {
    if (!isValueDisplayable(r) || !DISPLAYABLE_QUADRANTS.has(r.value_category ?? '')) continue
    const amt = Math.abs(Number(r.amount))
    spendByQuadrant[r.value_category as ValueQuadrant] += amt
    displayableTotal += amt
  }
  if (displayableTotal > 0) {
    let observed: ValueQuadrant = 'foundation'
    for (const q of ['foundation', 'investment', 'burden', 'leak'] as ValueQuadrant[]) {
      if (spendByQuadrant[q] > spendByQuadrant[observed]) observed = q
    }
    if (QUADRANT_FAMILY[observed] !== family) {
      return buildMismatchLine(
        family,
        FAMILY_QUADRANT[family],
        observed,
        Math.round(spendByQuadrant[observed]),
        Math.round(displayableTotal),
        inputs.currency,
      )
    }
  }

  // ── D2: protected but shrinking ──────────────────────────────────────────
  let best: { merchant: string; quadrant: ProtectedMerchant['quadrant']; pct: number; recent: number } | null = null
  for (const p of inputs.protectedMerchants) {
    let early = 0
    let recent = 0
    for (const r of inWindow) {
      if (normaliseMerchant(r.description ?? '') !== p.merchant) continue
      const month = r.date.slice(0, 7)
      const amt = Math.abs(Number(r.amount))
      if (month === earlyMonth) early += amt
      else if (month === recentMonth) recent += amt
    }
    if (early <= 0) continue
    const decline = (early - recent) / early
    if (decline >= SHRINK_THRESHOLD && (!best || decline > best.pct / 100)) {
      best = { merchant: p.merchant, quadrant: p.quadrant, pct: Math.round(decline * 100), recent }
    }
  }
  if (best) {
    return buildShrinkingLine(
      best.merchant,
      best.quadrant,
      best.pct,
      inputs.currency,
      Math.round(best.recent),
    )
  }

  return buildNoTensionLine(family, certainty)
}

/**
 * Fetch the transaction window the detectors need. One query; grouping
 * happens in detectTension so the core stays pure.
 */
export async function gatherTensionInputs(
  supabase: SupabaseClient,
  userId: string,
  protectedMerchants: ProtectedMerchant[],
  currency: string,
): Promise<TensionInputs> {
  const windowStart = monthStart(new Date(), 3)
  const { data, error } = await supabase
    .from('transactions')
    .select('description, amount, date, value_category, value_confidence, value_confirmed_by_user')
    .eq('user_id', userId)
    .lt('amount', 0)
    .gte('date', windowStart)
  if (error) {
    console.error('[vm4/tension] window fetch failed:', error)
    return { rows: [], protectedMerchants, currency }
  }
  return { rows: (data ?? []) as TensionTxnRow[], protectedMerchants, currency }
}
