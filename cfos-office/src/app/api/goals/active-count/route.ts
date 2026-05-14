import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Lightweight polling endpoint used by the GoalBeatWatcher in the office layout
// to detect when the user's first active goal lands during the goal-derive-and-
// confirm beat. Returns the count of non-deleted active goals.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ count: 0 }, { status: 401 })

  const { count, error } = await supabase
    .from('goals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'active')
    .is('deleted_at', null)

  if (error) {
    console.error('[goals/active-count] query error:', error)
    return NextResponse.json({ count: 0 }, { status: 500 })
  }

  return NextResponse.json({ count: count ?? 0 })
}
