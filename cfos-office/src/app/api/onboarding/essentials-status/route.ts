import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Lightweight polling endpoint used by the GoalBeatWatcher to detect when
// goal + essentials (net_monthly_income, monthly_rent) have all landed
// during the goal-derive-and-confirm beat. Replaces the older
// /api/goals/active-count endpoint for the watcher's purposes — the watcher
// advances only when both essentials are present (goal is optional, so
// dont_know pivots without a confirmed goal can still advance).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { goal: false, income: false, rent: false },
      { status: 401 },
    )
  }

  const [profileRes, goalRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('net_monthly_income, monthly_rent')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('goals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'active')
      .is('deleted_at', null),
  ])

  if (profileRes.error) {
    console.error('[onboarding/essentials-status] profile query error:', profileRes.error)
    return NextResponse.json(
      { goal: false, income: false, rent: false },
      { status: 500 },
    )
  }
  if (goalRes.error) {
    console.error('[onboarding/essentials-status] goal query error:', goalRes.error)
    return NextResponse.json(
      { goal: false, income: false, rent: false },
      { status: 500 },
    )
  }

  const income = profileRes.data?.net_monthly_income != null
  const rent = profileRes.data?.monthly_rent != null
  const goal = (goalRes.count ?? 0) > 0

  return NextResponse.json({ goal, income, rent })
}
