import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isValueDisplayable,
  UNMAPPED_BUCKET,
} from '@/lib/categorisation/value-config'
import {
  INCOME_CATEGORY_ID,
  UNCATEGORISED_CATEGORY_ID,
  isIncomeRow,
  isNeutralCategory,
  isSpendRow,
} from './categories'
import { detectIncomeShape } from './income-shape'
import { computeCashFlowAggregates } from './cashflow-aggregates'
import { detectPosture } from './posture'
import { reconcileFixedCosts } from './reconcile-fixed-costs'
import { alignmentFromValueBuckets } from '@/lib/value-map/alignment'

type SnapshotTxn = {
  amount: number | string
  category_id: string | null
  value_category: string | null
  value_confidence: number | null
  value_confirmed_by_user: boolean | null
  description: string
}

export type MonthAggregate = {
  totalIncome: number
  totalSpending: number
  spendingByCategory: Record<string, number>
  spendingByValueCategory: Record<string, number>
  largestTxn: number
  largestTxnDesc: string
  spendingRowCount: number
}

/**
 * Pure month-aggregation: turn a list of transactions into the snapshot
 * fields (income, spend, breakdowns, largest). Extracted from refreshOneMonth
 * so the bucketing rules can be unit-tested in isolation — they are the
 * source of nuanced bugs (income leaking into uncategorised, refund netting,
 * etc.).
 */
export function aggregateMonthSpending(txns: SnapshotTxn[]): MonthAggregate {
  // Income: positive amounts on the dedicated 'income' category only.
  // Refunds (positive amounts on a spending category) net against that
  // category, not income.
  const totalIncome = txns
    .filter((t) => isIncomeRow(t.amount, t.category_id))
    .reduce((s, t) => s + Number(t.amount), 0)

  // Net spend per category: outflow contributes positive, refund contributes negative.
  const spendingByCategory: Record<string, number> = {}
  const spendingByValueCategory: Record<string, number> = {}
  let largestTxn = 0
  let largestTxnDesc = ''
  let spendingRowCount = 0

  for (const txn of txns) {
    // Drop neutrals (transfers/debt/savings) and income — the same exclusions
    // affectsSpendingBreakdown enforced. NULL category rows fall through and
    // get bucketed under the synthetic 'uncategorised' slug so they still
    // count toward total_spending instead of vanishing silently.
    if (txn.category_id === INCOME_CATEGORY_ID) continue
    if (isNeutralCategory(txn.category_id)) continue

    // Null-categorised positive amounts are inflows (income / interest /
    // unclassified credits) that escaped the categoriser — they must not net
    // against uncategorised spend in the same bucket. Without this guard, a
    // user with €36k of null-categorised income produces large negative
    // values in spending_by_category.uncategorised which then poison every
    // downstream consumer (dashboard pct, pattern detectors, chat context).
    // Refunds with a valid spending category (positive amount, category_id
    // set) still net correctly below.
    if (Number(txn.amount) > 0 && !txn.category_id) continue

    const cid = (txn.category_id ?? UNCATEGORISED_CATEGORY_ID) as string
    const delta = -Number(txn.amount) // outflow → +ve, refund → -ve
    spendingByCategory[cid] = (spendingByCategory[cid] ?? 0) + delta
    // VM-1 honesty gate: only user-confirmed or high-confidence value labels
    // count toward a value bucket; everything else (low-confidence defaults,
    // 'unsure', legacy 'no_idea') aggregates under 'unmapped'.
    const vc = isValueDisplayable(txn)
      ? (txn.value_category as string)
      : UNMAPPED_BUCKET
    spendingByValueCategory[vc] = (spendingByValueCategory[vc] ?? 0) + delta

    if (isSpendRow(txn.amount, txn.category_id) || (Number(txn.amount) < 0 && !txn.category_id)) {
      spendingRowCount += 1
      const abs = -Number(txn.amount)
      if (abs > largestTxn) {
        largestTxn = abs
        largestTxnDesc = txn.description
      }
    }
  }

  // Total spending = sum of net category spends; clamp categories that net
  // negative (refund-heavy) to 0 so a single large refund can't make the
  // headline total negative.
  const totalSpending = Object.values(spendingByCategory).reduce(
    (s, v) => s + Math.max(v, 0),
    0,
  )

  return {
    totalIncome,
    totalSpending,
    spendingByCategory,
    spendingByValueCategory,
    largestTxn,
    largestTxnDesc,
    spendingRowCount,
  }
}

export async function refreshMonthlySnapshots(
  supabase: SupabaseClient,
  userId: string,
  affectedMonths: string[] // YYYY-MM strings
): Promise<void> {
  for (const month of affectedMonths) {
    await refreshOneMonth(supabase, userId, month)
  }
  // Order matters: closing_balance must populate first (posture reads it
  // via the cashflow aggregator), then shape (posture reads shape from
  // user_profiles), then posture. Each step is best-effort — failures are
  // logged but never throw so ingest still completes.
  await backfillClosingBalances(supabase, userId)
  await updateIncomeShape(supabase, userId)
  await updateFinancialPosture(supabase, userId)
  // total_fixed_costs is computed once per refresh and applied to every
  // snapshot row for the user. Fixed costs are a current-state attribute,
  // not a historical one — the user's rent + reconciled recurring set is
  // the same regardless of which month's snapshot is being inspected. The
  // First Read pulls this off the most recent snapshot.
  await syncTotalFixedCosts(supabase, userId)
}

/**
 * Compute the reconciled fixed-cost total once and stamp it — along with
 * `total_discretionary` (total_spending minus that same fixed-cost total,
 * floored at 0) — across the user's existing monthly_snapshots rows. The
 * value-first onboarding flow is the first writer; legacy users get NULL →
 * recomputed value the next time the upload pipeline runs.
 *
 * `total_discretionary` per row is NOT a per-row update (unlike
 * total_fixed_costs, which is the same value for every row) — it depends on
 * that row's own total_spending, so each row is fetched and updated
 * individually. This is the column financial-position.ts reads as
 * avgDiscretionaryMonthly; before it existed, every consumer's `?? 0`
 * fallback silently modelled every user as spending nothing beyond their
 * fixed bills (the root cause of the false "funded at plan / spare cash"
 * figures in the dorcas/lewis staging review).
 *
 * Exported so the processing-form server action can call it the moment
 * rent + detected recurring are both on file (the upload-time call inside
 * refreshMonthlySnapshots is a no-op on the first import because the
 * recurring detector hasn't run yet at that point).
 */
/**
 * NULL, not floored to 0, when a month's own total_spending is below the
 * CURRENT reconciled fixed-cost total. That combination means the month's
 * data doesn't reconcile with what's on file today — a partial upload
 * missing an account the fixed bills are paid from, or fixed costs that
 * have since risen — not "this user spent nothing on top of their bills."
 * Flooring that case to a confident 0 was itself a relocated version of the
 * exact bug being fixed: `average()` in financial-position.ts treats a run
 * of 0s as real observed history (basis: 'observed'), so a Read could state
 * an unhedged, overstated free-cash figure with high confidence. NULL
 * correctly falls out of the average and pushes basis back to 'modelled'.
 */
export function computeTotalDiscretionaryForRow(
  totalSpending: number | null,
  totalFixedCostsMonthly: number,
): number | null {
  return totalSpending != null && totalSpending >= totalFixedCostsMonthly
    ? totalSpending - totalFixedCostsMonthly
    : null
}

export async function syncTotalFixedCosts(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  let totalFixedCostsMonthly: number
  try {
    ;({ totalFixedCostsMonthly } = await reconcileFixedCosts(supabase, userId))
  } catch (err) {
    console.error('[syncTotalFixedCosts] reconcile failed:', err)
    return
  }

  const { data: rows, error: readError } = await supabase
    .from('monthly_snapshots')
    .select('id, total_spending')
    .eq('user_id', userId)

  if (readError) {
    console.error('[syncTotalFixedCosts] failed to load snapshot rows:', readError)
    return
  }

  for (const row of rows ?? []) {
    const totalSpending = typeof row.total_spending === 'number' ? row.total_spending : null
    const totalDiscretionary = computeTotalDiscretionaryForRow(totalSpending, totalFixedCostsMonthly)
    const { error } = await supabase
      .from('monthly_snapshots')
      .update({
        total_fixed_costs: totalFixedCostsMonthly,
        total_discretionary: totalDiscretionary,
      })
      .eq('id', row.id as string)
    if (error) {
      console.error('[syncTotalFixedCosts] update failed for snapshot', row.id, error)
    }
  }
}

async function refreshOneMonth(
  supabase: SupabaseClient,
  userId: string,
  month: string // YYYY-MM
): Promise<void> {
  const monthStart = `${month}-01`
  const [year, m] = month.split('-').map(Number)
  const nextMonth =
    m === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(m + 1).padStart(2, '0')}-01`

  const { data: txns, error: txnsError } = await supabase
    .from('transactions')
    .select('amount, category_id, value_category, value_confidence, value_confirmed_by_user, description')
    .eq('user_id', userId)
    .gte('date', monthStart)
    .lt('date', nextMonth)

  // A real DB error here must not read the same as "no transactions this
  // month" — that silent conflation is the same failure mode that made a
  // missing total_discretionary column invisible for its entire life.
  if (txnsError) {
    console.error('[refreshOneMonth] transactions read failed:', month, txnsError)
    return
  }
  if (!txns || txns.length === 0) return

  const {
    totalIncome,
    totalSpending,
    spendingByCategory,
    spendingByValueCategory,
    largestTxn,
    largestTxnDesc,
    spendingRowCount,
  } = aggregateMonthSpending(txns)
  const avgTxnSize = spendingRowCount > 0 ? totalSpending / spendingRowCount : 0

  // Previous month comparison
  const prevMonthStr =
    m === 1
      ? `${year - 1}-12`
      : `${year}-${String(m - 1).padStart(2, '0')}`
  const { data: prevSnap } = await supabase
    .from('monthly_snapshots')
    .select('total_spending')
    .eq('user_id', userId)
    .eq('month', `${prevMonthStr}-01`)
    .single()

  const vsPrevPct =
    prevSnap?.total_spending && prevSnap.total_spending > 0
      ? ((totalSpending - prevSnap.total_spending) / prevSnap.total_spending) * 100
      : null

  // VM-5: alignment is derived from the same bucket record persisted below,
  // so the stored score can never disagree with the jsonb other surfaces
  // render. Written unconditionally (no flag gate) — the columns are inert
  // until a VALUE_MAP_V2 surface reads them.
  const alignment = alignmentFromValueBuckets(spendingByValueCategory)

  await supabase.from('monthly_snapshots').upsert(
    {
      user_id: userId,
      month: monthStart,
      total_income: Math.round(totalIncome * 100) / 100,
      total_spending: Math.round(totalSpending * 100) / 100,
      surplus_deficit: Math.round((totalIncome - totalSpending) * 100) / 100,
      spending_by_category: spendingByCategory,
      spending_by_value_category: spendingByValueCategory,
      transaction_count: txns.length,
      avg_transaction_size: Math.round(avgTxnSize * 100) / 100,
      largest_transaction: Math.round(largestTxn * 100) / 100,
      largest_transaction_desc: largestTxnDesc || null,
      vs_previous_month_pct: vsPrevPct ? Math.round(vsPrevPct * 10) / 10 : null,
      aligned_spend_pct: alignment.alignedSpendPct,
      alignment_confidence: alignment.alignmentConfidence,
      alignment_version: alignment.version,
    },
    { onConflict: 'user_id,month' }
  )
}

/** Extract distinct YYYY-MM strings from an array of ISO dates */
export function extractAffectedMonths(dates: string[]): string[] {
  const months = new Set(dates.map((d) => d.slice(0, 7)))
  return Array.from(months).sort()
}

/**
 * Recompute and persist the user's income shape based on the last 12 months
 * of income-categorised transactions. Called at the end of refreshMonthlySnapshots
 * so every transaction ingest triggers a fresh classification.
 *
 * Forward-only: existing users without a recent ingest will sit at NULL until
 * their next refresh. No backfill is performed by this session.
 */
export async function updateIncomeShape(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 12)
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  const { data: txns, error } = await supabase
    .from('transactions')
    .select('amount, category_id, date')
    .eq('user_id', userId)
    .gte('date', cutoffIso)

  if (error) {
    console.error('[updateIncomeShape] failed to load transactions:', error)
    return
  }

  const result = detectIncomeShape(txns ?? [])

  // Provenance: did we actually SEE income land, or are we leaning on a figure
  // the user declared? When no income deposits are detected but the user
  // declared a net monthly income, mark it 'declared_unverified' so the Read
  // frames that number as stated-not-observed and asks where the salary lands.
  let income_provenance: string
  if (result.shape !== 'unknown') {
    income_provenance = 'observed'
  } else {
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('net_monthly_income')
      .eq('id', userId)
      .maybeSingle()
    income_provenance =
      prof?.net_monthly_income != null ? 'declared_unverified' : 'unknown'
  }

  const { error: upsertError } = await supabase
    .from('user_profiles')
    .update({
      income_shape: result.shape,
      income_volatility: result.volatility,
      income_shape_deposit_count: result.deposit_count,
      income_shape_detected_at: new Date().toISOString(),
      income_provenance,
    })
    .eq('id', userId)

  if (upsertError) {
    console.error('[updateIncomeShape] failed to persist:', upsertError)
  }
}

/**
 * Walk monthly snapshots most-recent first and populate closing_balance.
 *
 * Newest snapshot's closing_balance = current liquid balance from accounts
 * (filtered to spendable types). Each older row = newer row's closing
 * minus newer row's surplus_deficit. Stops at the first NULL surplus to
 * avoid poisoning trajectory for older history.
 *
 * No-ops when no liquid accounts exist or no snapshots are present. Newest
 * row's closing_balance is "balance as of refresh time", not strictly
 * month-end — acceptable for runway. Months with zero transactions have
 * no snapshot row and are silently skipped (real-world drift in those
 * gaps via interest / fees is not reconstructed).
 *
 * Multi-currency: amounts are summed naively, matching the existing
 * loadSavingsBalance helper. Documented limitation.
 */
export async function backfillClosingBalances(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: accounts, error: aErr } = await supabase
    .from('accounts')
    .select('current_balance, type')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .neq('type', 'credit_card')

  if (aErr) {
    console.error('[backfillClosingBalances] failed to load accounts:', aErr)
    return
  }

  if (!accounts || accounts.length === 0) return

  const liquidBalance = accounts
    .filter((a) => a.current_balance !== null)
    .reduce((s, a) => s + Number(a.current_balance), 0)

  if (!Number.isFinite(liquidBalance)) return

  const { data: snapshots, error: sErr } = await supabase
    .from('monthly_snapshots')
    .select('id, month, surplus_deficit')
    .eq('user_id', userId)
    .order('month', { ascending: false })

  if (sErr) {
    console.error('[backfillClosingBalances] failed to load snapshots:', sErr)
    return
  }

  if (!snapshots || snapshots.length === 0) return

  let runningBalance: number | null = liquidBalance
  for (const snap of snapshots) {
    if (runningBalance === null) break // poisoned by NULL surplus upstream

    const { error } = await supabase
      .from('monthly_snapshots')
      .update({ closing_balance: Math.round(runningBalance * 100) / 100 })
      .eq('id', snap.id)

    if (error) {
      console.error(
        '[backfillClosingBalances] failed to update snapshot',
        snap.id,
        error,
      )
      // Keep walking — best-effort.
    }

    const surplus = snap.surplus_deficit
    if (surplus === null || surplus === undefined) {
      runningBalance = null
    } else {
      runningBalance = runningBalance - Number(surplus)
    }
  }
}

/**
 * Recompute and persist the user's financial posture. Reads the freshly
 * persisted income_shape (set by updateIncomeShape) and combines with the
 * latest monthly snapshots + liquid balance from accounts.
 *
 * Forward-only: failures are logged but never block ingest.
 */
export async function updateFinancialPosture(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: profile, error: pErr } = await supabase
    .from('user_profiles')
    .select('income_shape')
    .eq('id', userId)
    .single()

  if (pErr || !profile?.income_shape) {
    console.warn('[updateFinancialPosture] no shape, skipping:', pErr)
    return
  }

  const { data: accounts, error: aErr } = await supabase
    .from('accounts')
    .select('current_balance, type')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .neq('type', 'credit_card')

  if (aErr) {
    console.error('[updateFinancialPosture] failed to load accounts:', aErr)
    return
  }

  const hasAccounts = !!accounts && accounts.length > 0
  const liquidSum = hasAccounts
    ? accounts!
        .filter((a) => a.current_balance !== null)
        .reduce((s, a) => s + Number(a.current_balance), 0)
    : 0
  const liquidBalance = hasAccounts && Number.isFinite(liquidSum) ? liquidSum : null

  const { data: snapshots, error: sErr } = await supabase
    .from('monthly_snapshots')
    .select('month, total_income, total_spending, closing_balance')
    .eq('user_id', userId)
    .order('month', { ascending: false })
    .limit(3)

  if (sErr) {
    console.error('[updateFinancialPosture] failed to load snapshots:', sErr)
    return
  }

  const aggregates = computeCashFlowAggregates(
    (snapshots ?? []).map((s) => ({
      month: typeof s.month === 'string' ? s.month : String(s.month),
      income_total: Number(s.total_income) || 0,
      spend_total: Number(s.total_spending) || 0,
      closing_balance:
        s.closing_balance === null || s.closing_balance === undefined
          ? null
          : Number(s.closing_balance),
    })),
    liquidBalance,
  )

  const { posture, confidence } = detectPosture(
    profile.income_shape as Parameters<typeof detectPosture>[0],
    aggregates,
  )

  const { error: upsertError } = await supabase
    .from('user_profiles')
    .update({
      financial_posture: posture,
      posture_confidence: confidence,
      runway_days: aggregates.runway_days,
      t3m_income_monthly: aggregates.t3m_income_monthly,
      t3m_spend_monthly: aggregates.t3m_spend_monthly,
      balance_trajectory: aggregates.balance_trajectory,
      posture_detected_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (upsertError) {
    console.error('[updateFinancialPosture] failed to persist:', upsertError)
  }
}
