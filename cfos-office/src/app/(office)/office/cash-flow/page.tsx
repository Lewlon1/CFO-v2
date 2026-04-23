import { createClient } from '@/lib/supabase/server'
import { CashFlowDashboard } from '@/components/office/dashboards/CashFlowDashboard'

export default async function CashFlowPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .maybeSingle()

  const currency = profile?.primary_currency ?? 'EUR'

  return <CashFlowDashboard currency={currency} />
}
