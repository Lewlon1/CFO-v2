import type { SupabaseClient } from '@supabase/supabase-js'

export async function detectAndFlagHolidaySpend(
  supabase: SupabaseClient,
  userId: string,
  userPrimaryCurrency: string,
  importBatchId: string
): Promise<void> {
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, date, currency')
    .eq('user_id', userId)
    .eq('import_batch_id', importBatchId)
    .neq('currency', userPrimaryCurrency)

  if (!txns || txns.length === 0) return

  // Group foreign-currency transactions into clusters (gap ≤ 2 days between consecutive)
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date))
  const clusters: string[][] = []
  let current: string[] = [sorted[0].id]

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].date)
    const curr = new Date(sorted[i].date)
    const gapDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
    if (gapDays <= 2) {
      current.push(sorted[i].id)
    } else {
      if (current.length >= 2) clusters.push(current)
      current = [sorted[i].id]
    }
  }
  if (current.length >= 2) clusters.push(current)

  for (const cluster of clusters) {
    await supabase.from('transactions').update({ is_holiday_spend: true }).in('id', cluster)
  }
}
