import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

type TxnRow = {
  id: string
  date: string
  amount: number
  description: string
  category_id: string | null
}

export async function detectAndFlagRecurring(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const { data: txns } = await supabase
    .from('transactions')
    .select('id, date, amount, description, category_id')
    .eq('user_id', userId)
    .gte('date', sixMonthsAgo.toISOString().slice(0, 10))
    .lt('amount', 0)
    .order('date', { ascending: true })

  if (!txns || txns.length < 2) return

  // Group by normalised description
  const groups = new Map<string, TxnRow[]>()
  for (const txn of txns) {
    const key = normaliseMerchant(txn.description)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(txn)
  }

  for (const [normDesc, rows] of groups) {
    if (rows.length < 2) continue

    const months = new Set(rows.map((r) => r.date.slice(0, 7)))
    if (months.size < 2) continue

    const dates = rows.map((r) => new Date(r.date)).sort((a, b) => a.getTime() - b.getTime())
    const gaps: number[] = []
    for (let i = 1; i < dates.length; i++) {
      gaps.push(
        Math.round((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24))
      )
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length

    let frequency = 'monthly'
    let billingDay: number | null = dates[dates.length - 1].getDate()

    if (avgGap > 80 && avgGap < 100) {
      frequency = 'bi-monthly'
    } else if (avgGap > 25 && avgGap < 35) {
      frequency = 'monthly'
    } else if (avgGap > 55 && avgGap < 75) {
      frequency = 'bi-monthly'
    } else if (avgGap > 350 && avgGap < 380) {
      frequency = 'annual'
    } else {
      frequency = 'irregular'
      billingDay = null
    }

    const avgAmount = Math.abs(rows.reduce((s, r) => s + r.amount, 0) / rows.length)
    const latestRow = rows[rows.length - 1]

    const ids = rows.map((r) => r.id)
    await supabase.from('transactions').update({ is_recurring: true }).in('id', ids)

    // Upsert to recurring_expenses — relies on unique constraint (user_id, name)
    await supabase
      .from('recurring_expenses')
      .upsert(
        {
          user_id: userId,
          name: normDesc,
          amount: Math.round(avgAmount * 100) / 100,
          currency: 'EUR',
          frequency,
          billing_day: billingDay,
          category_id: latestRow.category_id,
        },
        { onConflict: 'user_id,name', ignoreDuplicates: false }
      )
      .then(({ error }) => {
        if (error) {
          // If constraint doesn't exist yet, silently skip — is_recurring flag is still set
          console.warn('[recurring-detector] upsert skipped:', error.message)
        }
      })
  }
}
