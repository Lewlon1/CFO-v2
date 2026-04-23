import { createClient } from '@/lib/supabase/server'
import {
  ScenariosDashboard,
  type ScenariosDashboardGoal,
  type ScenariosDashboardTrip,
  type ScenariosDashboardScenario,
} from '@/components/office/dashboards/ScenariosDashboard'

export const dynamic = 'force-dynamic'

export default async function ScenariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const today = new Date().toISOString().split('T')[0]

  const [profileResult, goalsResult, tripsResult, scenariosResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('primary_currency')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('goals')
      .select('id, name, current_amount, target_amount, on_track, status, target_date')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .eq('status', 'active')
      .order('target_date', { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from('trips')
      .select('id, name, destination, start_date, end_date, total_estimated, currency, status')
      .eq('user_id', user.id)
      .gte('start_date', today)
      .neq('status', 'cancelled')
      .order('start_date', { ascending: true })
      .limit(3),
    supabase
      .from('conversations')
      .select('id, title, updated_at')
      .eq('user_id', user.id)
      .eq('type', 'scenario')
      .order('updated_at', { ascending: false })
      .limit(5),
  ])

  const currency = profileResult.data?.primary_currency ?? 'EUR'

  const goals: ScenariosDashboardGoal[] = (goalsResult.data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    current_amount: Number(g.current_amount ?? 0),
    target_amount: Number(g.target_amount ?? 0),
    on_track: g.on_track,
    status: g.status,
    target_date: g.target_date,
  }))

  const trips: ScenariosDashboardTrip[] = (tripsResult.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    destination: t.destination ?? null,
    start_date: t.start_date,
    end_date: t.end_date,
    total_estimated: t.total_estimated != null ? Number(t.total_estimated) : null,
    currency: t.currency ?? currency,
    status: t.status ?? null,
  }))

  const recentScenarios: ScenariosDashboardScenario[] = (scenariosResult.data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    updated_at: s.updated_at,
  }))

  return (
    <ScenariosDashboard
      currency={currency}
      goals={goals}
      trips={trips}
      recentScenarios={recentScenarios}
    />
  )
}
