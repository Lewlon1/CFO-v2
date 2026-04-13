import { createClient } from '@/lib/supabase/server'
import { PatternsClient } from './PatternsClient'

export default async function PatternsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: recurring } = await supabase
    .from('recurring_expenses')
    .select('id, name, amount, currency, frequency, billing_day, category_id')
    .eq('user_id', user.id)
    .is('provider', null)
    .neq('status', 'tracked')
    .neq('status', 'dismissed')
    .order('amount', { ascending: false })

  return <PatternsClient patterns={recurring || []} />
}
