import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Lightweight polling endpoint used by the GoalBeatWatcher to detect when the
// goal beat is ready to hand off to upload. The watcher advances when either a
// goal lands OR the onboarding step has moved to `goal_chat_tentative` (the
// deferral / stall hand-off state) — so a user who never confirms a goal still
// gets routed onward instead of stranded on the chat screen. `step` is
// returned for that tentative-aware routing.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { goal: false, income: false, rent: false, step: null },
      { status: 401 },
    )
  }

  const [profileRes, goalRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('net_monthly_income, monthly_rent, onboarding_step')
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
      { goal: false, income: false, rent: false, step: null },
      { status: 500 },
    )
  }
  if (goalRes.error) {
    console.error('[onboarding/essentials-status] goal query error:', goalRes.error)
    return NextResponse.json(
      { goal: false, income: false, rent: false, step: null },
      { status: 500 },
    )
  }

  const income = profileRes.data?.net_monthly_income != null
  const rent = profileRes.data?.monthly_rent != null
  const goal = (goalRes.count ?? 0) > 0
  const step = (profileRes.data?.onboarding_step ?? null) as string | null

  return NextResponse.json({ goal, income, rent, step })
}
