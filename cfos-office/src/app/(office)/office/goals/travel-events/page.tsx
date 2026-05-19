import { createClient } from '@/lib/supabase/server'
import { TripsClient } from '@/components/trips/TripsClient'

export default async function TravelEventsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: events } = await supabase
    .from('events')
    .select('id, name, destination, start_date, end_date, total_estimated, total_actual, status, currency, goal_id, conversation_id, funding_plan, kind')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const goalIds = (events ?? []).map(t => t.goal_id).filter(Boolean)
  let goals: Record<string, { current_amount: number; target_amount: number }> = {}
  if (goalIds.length > 0) {
    const { data: goalData } = await supabase
      .from('goals')
      .select('id, current_amount, target_amount')
      .in('id', goalIds)
    if (goalData) {
      goals = Object.fromEntries(goalData.map(g => [g.id, { current_amount: Number(g.current_amount || 0), target_amount: Number(g.target_amount || 0) }]))
    }
  }

  return <TripsClient trips={events ?? []} goals={goals} />
}
