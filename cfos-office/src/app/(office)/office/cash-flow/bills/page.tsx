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
    .order('amount', { ascending: false })

  return <BillsClient bills={bills || []} />
}
