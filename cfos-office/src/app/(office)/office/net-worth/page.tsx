import { createClient } from '@/lib/supabase/server'
import { NetWorthDashboard } from '@/components/office/dashboards/NetWorthDashboard'
import { FilesSection } from '@/components/office/files/FilesSection'

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

  return (
    <>
      <NetWorthDashboard currency={currency} />
      {/* The dashboard reserves pb-24 for the chat bar; pull the files list up
          into it so it reads as the next section, not a second screen. */}
      <div className="px-3.5 -mt-20 pb-24">
        <FilesSection folder="networth" />
      </div>
    </>
  )
}
