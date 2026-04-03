import { createClient } from '@/lib/supabase/server'
import { TransactionsClient } from '@/components/transactions/TransactionsClient'
import type { Category } from '@/lib/parsers/types'
import type { Transaction } from '@/components/transactions/TransactionList'

export default async function TransactionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: catData }, { data: txnData }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, tier, icon, color, examples, default_value_category')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('transactions')
      .select('id, date, description, amount, currency, category_id, value_category, is_recurring, is_holiday_spend, user_confirmed')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(1000),
  ])

  const categories: Category[] = catData ?? []
  const transactions: Transaction[] = txnData ?? []

  return (
    <TransactionsClient
      transactions={transactions}
      categories={categories}
    />
  )
}
