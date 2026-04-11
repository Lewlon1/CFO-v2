import { createClient } from '@/lib/supabase/server'
import { TransactionsClient } from '@/components/transactions/TransactionsClient'
import type { Category } from '@/lib/parsers/types'
import type { Transaction } from '@/components/transactions/TransactionList'
import type { FilterState } from '@/components/transactions/TransactionFilters'

type Props = {
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function TransactionsPage({ searchParams }: Props) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Confidence filter: when ?confidence=low, only show auto-sorted transactions
  const confidenceFilter = params.confidence === 'low'

  let txnQuery = supabase
    .from('transactions')
    .select('id, date, description, amount, currency, category_id, value_category, value_confidence, value_confirmed_by_user, is_recurring, is_holiday_spend, user_confirmed, auto_category_confidence')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(1000)

  if (confidenceFilter) {
    txnQuery = txnQuery.lt('auto_category_confidence', 0.8).eq('user_confirmed', false)
  }

  const [{ data: catData }, { data: txnData }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, tier, icon, color, examples, default_value_category')
      .eq('is_active', true)
      .order('name'),
    txnQuery,
  ])

  const categories: Category[] = catData ?? []
  const transactions: Transaction[] = txnData ?? []

  const initialFilters: FilterState = {
    search: params.search ?? '',
    categoryId: params.category ?? '',
    valueCategory: params.value_category ?? '',
    month: params.month ?? '',
  }

  return (
    <TransactionsClient
      transactions={transactions}
      categories={categories}
      initialFilters={initialFilters}
    />
  )
}
