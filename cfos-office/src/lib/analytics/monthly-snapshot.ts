import type { SupabaseClient } from '@supabase/supabase-js'
import {
  INCOME_CATEGORY_ID,
  UNCATEGORISED_CATEGORY_ID,
  isIncomeRow,
  isNeutralCategory,
  isSpendRow,
} from './categories'
import { detectIncomeShape } from './income-shape'

export async function refreshMonthlySnapshots(
  supabase: SupabaseClient,
  userId: string,
  affectedMonths: string[] // YYYY-MM strings
): Promise<void> {
  for (const month of affectedMonths) {
    await refreshOneMonth(supabase, userId, month)
  }
  // Income shape detection runs after monthly snapshots are current.
  // Best-effort: failures are logged but do not block ingest.
  await updateIncomeShape(supabase, userId)
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

  // Income: positive amounts on the dedicated 'income' category only.
  // Refunds (positive amounts on a spending category) net against that category, not income.
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

  // Total spending = sum of net category spends; clamp categories that net negative (refund-heavy) to 0
  // so a single large refund can't make the headline total negative.
  const totalSpending = Object.values(spendingByCategory).reduce((s, v) => s + Math.max(v, 0), 0)
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
