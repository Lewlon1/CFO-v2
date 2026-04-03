import type { SupabaseClient } from '@supabase/supabase-js'

export async function refreshMonthlySnapshots(
  supabase: SupabaseClient,
  userId: string,
  affectedMonths: string[] // YYYY-MM strings
): Promise<void> {
  for (const month of affectedMonths) {
    await refreshOneMonth(supabase, userId, month)
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

  const { data: txns } = await supabase
    .from('transactions')
    .select('amount, category_id, value_category, description')
    .eq('user_id', userId)
    .gte('date', monthStart)
    .lt('date', nextMonth)

  if (!txns || txns.length === 0) return

  const totalIncome = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalSpending = Math.abs(txns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0))

  const spendingByCategory: Record<string, number> = {}
  const spendingByValueCategory: Record<string, number> = {}
  let largestTxn = 0
  let largestTxnDesc = ''

  for (const txn of txns) {
    if (txn.amount >= 0) continue
    const abs = Math.abs(txn.amount)
    if (txn.category_id) {
      spendingByCategory[txn.category_id] = (spendingByCategory[txn.category_id] ?? 0) + abs
    }
    const vc = txn.value_category ?? 'unsure'
    spendingByValueCategory[vc] = (spendingByValueCategory[vc] ?? 0) + abs
    if (abs > largestTxn) {
      largestTxn = abs
      largestTxnDesc = txn.description
    }
  }

  const spendingTxns = txns.filter((t) => t.amount < 0)
  const avgTxnSize = spendingTxns.length > 0 ? totalSpending / spendingTxns.length : 0

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
