import { createClient } from '@/lib/supabase/server'
import { OfficeTransactionsClient } from './OfficeTransactionsClient'

const CATEGORY_EMOJI: Record<string, string> = {
  groceries: '🛒',
  eat_drinking_out: '🍽',
  transport: '🚌',
  travel: '✈️',
  entertainment: '🎮',
  shopping: '🛍',
  health: '💊',
  bills: '⚡',
  housing: '🏠',
  subscriptions: '📱',
}

export default async function TransactionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: catData }, { data: txnData }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, icon, color')
      .eq('is_active', true),
    supabase
      .from('transactions')
      .select('id, date, description, amount, currency, category_id, value_category')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(1000),
  ])

  // Build category map with emoji icons
  const categoryMap: Record<string, { name: string; icon: string; color: string }> = {}
  for (const cat of catData ?? []) {
    categoryMap[cat.id] = {
      name: cat.name,
      icon: CATEGORY_EMOJI[cat.id] ?? '📋',
      color: cat.color ?? '#22C55E',
    }
  }

  return (
    <OfficeTransactionsClient
      transactions={txnData ?? []}
      categoryMap={categoryMap}
    />
  )
}
