// VM-3 — deterministic payback computation for the post-Read Value Map.
//
// "X answers → {mapped} transactions mapped → €{monthlyMapped}/month now
// carries your values." Every number here is computed from the database
// state AFTER the card session's rules + re-score have landed — nothing is
// estimated and nothing involves an LLM. The figures must reconcile against
// direct SQL to the cent.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isValueDisplayable } from '@/lib/categorisation/value-config'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import type { ValueQuadrant } from './types'

export interface PaybackSummary {
  /** Cards answered with a quadrant (not "unsure"). */
  answers: number
  /** Transactions (all history) whose value label is now displayable and
   *  belongs to one of the answered merchants. */
  mappedTransactions: number
  /** Total |amount| of those transactions / distinct months they span. */
  monthlyMapped: number
  /** monthlyMapped split by current value category. */
  monthlyByQuadrant: Record<ValueQuadrant, number>
  /** Distinct YYYY-MM months the mapped transactions span (the divisor). */
  monthsSpanned: number
}

/** Transaction row shape the pure computation operates on. */
export interface PaybackTxnRow {
  description: string | null
  amount: number
  date: string
  value_category: string | null
  value_confidence: number | null
  value_confirmed_by_user: boolean | null
}

const QUADRANTS: ValueQuadrant[] = ['foundation', 'investment', 'burden', 'leak']

/**
 * Pure core — exported for unit tests. `answeredMerchants` holds normalised
 * merchant keys the user just sorted; `rows` is the user's outflow history.
 */
export function computePayback(
  rows: PaybackTxnRow[],
  answeredMerchants: ReadonlySet<string>,
  answers: number,
): PaybackSummary {
  const months = new Set<string>()
  let total = 0
  let mapped = 0
  const byQuadrant: Record<ValueQuadrant, number> = {
    foundation: 0,
    investment: 0,
    burden: 0,
    leak: 0,
  }

  for (const row of rows) {
    if (Number(row.amount) >= 0) continue
    const key = normaliseMerchant(row.description ?? '')
    if (!key || !answeredMerchants.has(key)) continue
    if (
      !isValueDisplayable({
        value_category: row.value_category,
        value_confidence: row.value_confidence === null ? null : Number(row.value_confidence),
        value_confirmed_by_user: row.value_confirmed_by_user,
      })
    ) {
      continue
    }
    const quadrant = row.value_category as ValueQuadrant
    if (!QUADRANTS.includes(quadrant)) continue
    const spend = Math.abs(Number(row.amount))
    mapped += 1
    total += spend
    byQuadrant[quadrant] += spend
    months.add(String(row.date).slice(0, 7))
  }

  const monthsSpanned = Math.max(1, months.size)
  const divide = (n: number) => Math.round((n / monthsSpanned) * 100) / 100

  return {
    answers,
    mappedTransactions: mapped,
    monthlyMapped: divide(total),
    monthlyByQuadrant: {
      foundation: divide(byQuadrant.foundation),
      investment: divide(byQuadrant.investment),
      burden: divide(byQuadrant.burden),
      leak: divide(byQuadrant.leak),
    },
    monthsSpanned,
  }
}

const PAGE_SIZE = 1000

/**
 * IO wrapper — pages through the user's live outflow transactions (all
 * history: the whole point of VM-2 is that rules reach backwards) and runs
 * the pure core.
 */
export async function computePaybackForUser(
  supabase: SupabaseClient,
  userId: string,
  answeredMerchants: ReadonlySet<string>,
  answers: number,
): Promise<PaybackSummary> {
  const rows: PaybackTxnRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('transactions')
      .select(
        'description, amount, date, value_category, value_confidence, value_confirmed_by_user',
      )
      .eq('user_id', userId)
      .is('deleted_at', null)
      .lt('amount', 0)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[payback] transaction page load failed:', error)
      break
    }
    rows.push(...((data ?? []) as PaybackTxnRow[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return computePayback(rows, answeredMerchants, answers)
}
