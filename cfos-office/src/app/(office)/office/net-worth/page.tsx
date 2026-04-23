import { createClient } from '@/lib/supabase/server'
import { NetWorthDashboard } from '@/components/office/dashboards/NetWorthDashboard'

export const dynamic = 'force-dynamic'

export default async function NetWorthPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .maybeSingle()

  const currency = profile?.primary_currency ?? 'EUR'

  return <NetWorthDashboard currency={currency} />
}
