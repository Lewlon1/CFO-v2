import type { SupabaseClient } from '@supabase/supabase-js'
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

type SnapshotTxn = {
  amount: number | string
  category_id: string | null
  value_category: string | null
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
    const vc = txn.value_category ?? 'unsure'
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

  const { data: txns } = await supabase
    .from('transactions')
    .select('amount, category_id, value_category, description')
    .eq('user_id', userId)
    .gte('date', monthStart)
    .lt('date', nextMonth)

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

  const { error: upsertError } = await supabase
    .from('user_profiles')
    .update({
      income_shape: result.shape,
      income_volatility: result.volatility,
      income_shape_deposit_count: result.deposit_count,
      income_shape_detected_at: new Date().toISOString(),
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
