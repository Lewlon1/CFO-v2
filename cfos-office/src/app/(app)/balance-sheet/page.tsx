import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BalanceSheetClient } from '@/components/balance-sheet/BalanceSheetClient'
import type { Category } from '@/lib/parsers/types'

export default async function BalanceSheetPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: catData } = await supabase
    .from('categories')
    .select('id, name, tier, icon, color, examples, default_value_category')
    .eq('is_active', true)
    .order('name')

  const categories: Category[] = catData ?? []

  return (
    <div className="flex flex-col h-full">
      <BalanceSheetClient categories={categories} />
    </div>
  )
}
