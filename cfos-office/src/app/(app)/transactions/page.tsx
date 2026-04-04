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
    />
  )
}
