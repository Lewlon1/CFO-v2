import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { getTimeContext } from '@/lib/utils/time-context'
import { processSignals } from '@/lib/prediction/process-signals'
import { rescoreValueCategories } from '@/lib/categorisation/value-rescore'
import { VCR_ON_CONFLICT, NONE_TIME_CONTEXT } from '@/lib/prediction/types'
import {
  refreshMonthlySnapshots,
  extractAffectedMonths,
} from '@/lib/analytics/monthly-snapshot'

// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for "the user classified these REAL transactions".
//
// Both the personal retake route (`/api/value-map/personal`) and the
// value-first onboarding flow (`/api/value-map/classify`, POSTed from
// value-map-flow.tsx) route through here so the two paths cannot drift:
//
//   1. weighted correction_signals (the learning-engine input)
//   2. a synchronous merchant value_category_rules row — this is what
//      Layer 2 `by_merchant` reads, and the onboarding recompose runs
//      immediately after, so the rule MUST land before this returns
//      (processSignals alone, deferred via after(), is too late and would
//      regress the recompose's "what you just sorted" payoff)
//   3. a hard transaction confirm (value_confirmed_by_user = true)
//   4. fresh monthly snapshots for the affected months
//   5. async learning — processSignals per merchant, then one full
//      rescoreValueCategories pass (VM-2, superseding the deleted
//      backfillForMerchant) — run by the caller inside after() via
//      runMerchantLearning(), so each route can chain its own follow-up
//      (archetype regen on the retake).
// ─────────────────────────────────────────────────────────────────────────

export const VALID_QUADRANTS = new Set(['foundation', 'investment', 'burden', 'leak'])

export type Quadrant = 'foundation' | 'investment' | 'burden' | 'leak'

export type RealClassificationInput = {
  transaction_id: string
  quadrant: Quadrant
  /** 1–5 card confidence; seeds the synchronous merchant rule (÷5). */
  confidence?: number
}

export type PersistResult = {
  classified: number
  /** Unique normalised merchants that received a signal — feed runMerchantLearning. */
  merchantsAffected: string[]
  affectedDates: string[]
}

/**
 * Persist a batch of real-transaction value classifications. Synchronous DB
 * work only (signals + merchant rule + confirm + snapshots); the caller is
 * responsible for scheduling runMerchantLearning() in after().
 */
export async function persistRealValueClassifications(
  supabase: SupabaseClient,
  userId: string,
  classifications: RealClassificationInput[],
  opts: { weightMultiplier: number },
): Promise<PersistResult> {
  const actionable = classifications.filter(
    (r) => r.transaction_id && r.quadrant && VALID_QUADRANTS.has(r.quadrant),
  )
  if (actionable.length === 0) {
    return { classified: 0, merchantsAffected: [], affectedDates: [] }
  }

  // 1. Fetch transaction details in one query (RLS via user_id filter)
  const ids = actionable.map((r) => r.transaction_id)
  const { data: transactions, error: fetchError } = await supabase
    .from('transactions')
    .select('id, description, date, amount, category_id')
    .eq('user_id', userId)
    .in('id', ids)

  if (fetchError) {
    throw new Error(
      `persistRealValueClassifications: could not load transactions — ${fetchError.message}`,
    )
  }

  const txnMap = new Map((transactions ?? []).map((t) => [t.id, t]))
  const now = new Date().toISOString()

  // 2. Weighted correction signals (the learning-engine input)
  const signalRows = actionable
    .map((r) => {
      const txn = txnMap.get(r.transaction_id)
      if (!txn) return null
      const merchantClean = normaliseMerchant(txn.description)
      if (!merchantClean) return null
      const txnDate = new Date(txn.date)
      return {
        user_id: userId,
        transaction_id: r.transaction_id,
        merchant_clean: merchantClean,
        category_id: txn.category_id,
        value_category: r.quadrant,
        amount: Number(txn.amount),
        transaction_time: txn.date,
        time_context: getTimeContext(txnDate),
        day_of_month: txnDate.getDate(),
        weight_multiplier: opts.weightMultiplier,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (signalRows.length > 0) {
    const { error: signalError } = await supabase
      .from('correction_signals')
      .insert(signalRows)
    if (signalError) {
      console.error('[persistRealValueClassifications] signal insert error:', signalError)
      // non-fatal — continue with the confirm + rule so the user's call still lands
    }
  }

  // 3. Synchronous merchant rule (source='value_map_personal'). One row per
  //    merchant (last decided quadrant wins), keyed on the SAME normalised
  //    merchant + NONE time_context that processSignals' flat rule uses, so
  //    the later async learning merges onto this row rather than forking it.
  //    Layer 2 `by_merchant` reads this immediately — the recompose depends
  //    on it being present before this function returns.
  const ruleByMerchant = new Map<
    string,
    { value_category: Quadrant; confidence: number }
  >()
  for (const r of actionable) {
    const txn = txnMap.get(r.transaction_id)
    if (!txn) continue
    const merchantClean = normaliseMerchant(txn.description)
    if (!merchantClean) continue
    ruleByMerchant.set(merchantClean, {
      value_category: r.quadrant,
      confidence: (r.confidence ?? 3) / 5,
    })
  }

  if (ruleByMerchant.size > 0) {
    const ruleRows = [...ruleByMerchant.entries()].map(([merchant, v]) => ({
      user_id: userId,
      match_type: 'merchant' as const,
      match_value: merchant,
      value_category: v.value_category,
      confidence: v.confidence,
      time_context: NONE_TIME_CONTEXT,
      source: 'value_map_personal',
      last_signal_at: now,
      updated_at: now,
    }))
    const { error: rulesError } = await supabase
      .from('value_category_rules')
      .upsert(ruleRows, { onConflict: VCR_ON_CONFLICT })
    if (rulesError) {
      console.error('[persistRealValueClassifications] rule upsert error:', rulesError)
    }
  }

  // 4. Hard-confirm the carded transactions (loop — distinct values per row)
  const affectedDates: string[] = []
  for (const r of actionable) {
    const txn = txnMap.get(r.transaction_id)
    if (!txn) continue
    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        value_category: r.quadrant,
        value_confidence: 1.0,
        value_confirmed_by_user: true,
        prediction_source: 'user_confirmed',
        confirmed_at: now,
      })
      .eq('id', r.transaction_id)
      .eq('user_id', userId)
    if (!updateError) affectedDates.push(txn.date)
  }

  // 5. Refresh monthly snapshots for affected months (awaited so the impact /
  //    recompose surface reads fresh totals)
  if (affectedDates.length > 0) {
    const months = extractAffectedMonths(affectedDates)
    try {
      await refreshMonthlySnapshots(supabase, userId, months)
    } catch (err) {
      console.error('[persistRealValueClassifications] snapshot refresh failed:', err)
    }
  }

  const merchantsAffected = [...new Set(signalRows.map((s) => s.merchant_clean))]
  return { classified: actionable.length, merchantsAffected, affectedDates }
}

/**
 * Run the async learning pass for the affected merchants — recompute rules from
 * the accumulated signals per merchant, then re-score the user's unconfirmed
 * transactions ONCE against the refreshed rule set. Designed to be called from a
 * route's after() so the user never waits. Errors per merchant are swallowed
 * (logged) so one failure does not abort the rest.
 *
 * VM-2 replaced the old per-merchant `backfillForMerchant` (ilike propagation,
 * deleted with prediction/backfill.ts) with a single `rescoreValueCategories`
 * pass. That is strictly broader: it applies the refreshed rules retroactively
 * across ALL history, including the category/global priors processSignals just
 * moved — which the per-merchant backfill could never reach. It runs once after
 * the loop rather than per merchant so N merchants cost one scan, not N.
 */
export async function runMerchantLearning(
  userId: string,
  merchants: string[],
): Promise<void> {
  for (const merchant of merchants) {
    try {
      await processSignals(userId, merchant)
    } catch (err) {
      console.error(`[value-map learning] ${merchant} failed:`, err)
    }
  }

  try {
    await rescoreValueCategories(userId)
  } catch (err) {
    console.error('[value-map learning] rescore failed:', err)
  }
}
