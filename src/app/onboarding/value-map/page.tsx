import { createClient } from '@/lib/supabase/server'
import { selectTransactions } from '@/lib/value-map/selection'
import { ValueMapFlow } from '@/components/value-map/value-map-flow'
import type { ValueMapTransaction } from '@/lib/value-map/types'

export default async function ValueMapPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Auth is already handled by the onboarding layout, but guard anyway
  if (!user) return null

  // Read profile for currency
  const { data: profile } = await supabase
    .from('profiles')
    .select('currency')
    .eq('id', user.id)
    .maybeSingle()

  const currency = profile?.currency ?? 'GBP'

  // Check if user already has transactions
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id, merchant, description, amount, currency, transaction_date, is_recurring, category_name')
    .eq('profile_id', user.id)
    .eq('type', 'expense')
    .order('amount', { ascending: false })
    .limit(100)

  let preSelected: ValueMapTransaction[] | undefined
  if (existingTx && existingTx.length > 0) {
    const mapped: ValueMapTransaction[] = existingTx.map((t) => ({
      id: t.id,
      merchant: t.merchant,
      description: t.description,
      amount: t.amount,
      currency: t.currency ?? currency,
      transaction_date: t.transaction_date,
      is_recurring: t.is_recurring,
      category_name: t.category_name,
    }))
    const selected = selectTransactions(mapped)
    if (selected.length >= 5) {
      preSelected = selected
    }
  }

  return (
    <ValueMapFlow
      currency={currency}
      existingTransactions={preSelected}
    />
  )
}
