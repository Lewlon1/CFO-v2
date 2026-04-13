import { createClient } from '@/lib/supabase/server'
import { TransactionsClient } from '@/components/transactions/TransactionsClient'
import type { Category } from '@/lib/parsers/types'
import type { Transaction } from '@/components/transactions/TransactionList'
import type { FilterState } from '@/components/transactions/TransactionFilters'
import type { UncategorisedTransaction } from '@/components/transactions/UncategorisedQueue'

type Props = {
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function TransactionsPage({ searchParams }: Props) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: catData }, { data: txnData }, { data: uncatData, count: uncatCount }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, tier, icon, color, examples, default_value_category')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('transactions')
      .select('id, date, description, amount, currency, category_id, value_category, value_confidence, value_confirmed_by_user, prediction_source, is_recurring, is_holiday_spend, user_confirmed')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(1000),
    supabase
      .from('transactions')
      .select('id, date, description, amount, currency, value_category, value_confidence, category_id', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('value_confirmed_by_user', false)
      .or('value_category.is.null,value_confidence.lt.0.25,value_category.eq.no_idea')
      .order('amount', { ascending: true }) // largest expenses first (negative amounts)
      .limit(10),
  ])

  const categories: Category[] = catData ?? []
  const transactions: Transaction[] = txnData ?? []
  const uncategorised: UncategorisedTransaction[] = uncatData ?? []

  // Build initial filters from URL search params
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
      uncategorised={uncategorised}
      uncategorisedCount={uncatCount ?? 0}
    />
  )
}
