import { createClient } from '@/lib/supabase/server'
import { BillsClient } from '@/components/bills/BillsClient'

export default async function BillsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: bills } = await supabase
    .from('recurring_expenses')
    .select('*')
    .eq('user_id', user.id)
    .neq('status', 'dismissed')
    .order('amount', { ascending: false })

  // Bills page shows only known providers + manually tracked items
  const filteredBills = (bills || []).filter(
    (b) => b.provider != null || b.status === 'tracked'
  )

  return <BillsClient bills={filteredBills} />
}
