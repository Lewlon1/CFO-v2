import type { SupabaseClient } from '@supabase/supabase-js'

export async function detectAndFlagHolidaySpend(
  supabase: SupabaseClient,
  userId: string,
  userPrimaryCurrency: string,
  importBatchId: string
): Promise<void> {
  // If we don't know the user's currency, skip holiday detection entirely
  if (!userPrimaryCurrency) return

  const { data: batchTxns } = await supabase
    .from('transactions')
    .select('id, date, currency')
    .eq('user_id', userId)
    .eq('import_batch_id', importBatchId)

  if (!batchTxns || batchTxns.length === 0) return

  // Determine the dominant currency in this batch (the "account currency")
  const currencyCounts = new Map<string, number>()
  for (const t of batchTxns) {
    currencyCounts.set(t.currency, (currencyCounts.get(t.currency) ?? 0) + 1)
  }
  const batchCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

  // Only consider transactions foreign if they differ from BOTH
  // the user's primary currency AND the batch's dominant currency.
  // This prevents a EUR account from being flagged as "all holiday" for a GBP user.
  const foreignTxns = batchTxns.filter(
    (t) => t.currency !== userPrimaryCurrency && t.currency !== batchCurrency
  )

  if (foreignTxns.length === 0) return

  // Group foreign-currency transactions into clusters (gap <= 2 days between consecutive)
  const sorted = [...foreignTxns].sort((a, b) => a.date.localeCompare(b.date))
  const clusters: string[][] = []
  let current: string[] = [sorted[0].id]

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].date)
    const curr = new Date(sorted[i].date)
    const gapDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
    if (gapDays <= 2) {
      current.push(sorted[i].id)
    } else {
      if (current.length >= 3) clusters.push(current)
      current = [sorted[i].id]
    }
  }
  if (current.length >= 3) clusters.push(current)

  for (const cluster of clusters) {
    await supabase.from('transactions').update({ is_holiday_spend: true }).in('id', cluster)
  }
}
