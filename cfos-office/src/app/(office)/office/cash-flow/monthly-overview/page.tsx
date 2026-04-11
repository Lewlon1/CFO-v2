import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import { NudgeBanner } from '@/components/dashboard/NudgeBanner'

export default async function MonthlyOverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { count } = await supabase
    .from('monthly_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4">
        <NudgeBanner />
      </div>
      <DashboardClient hasData={(count ?? 0) > 0} />
    </div>
  )
}
