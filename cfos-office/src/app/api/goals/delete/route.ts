import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Soft-delete a goal. Sets status='deleted' (so the chat/nudge/review readers
// that filter status='active' naturally exclude it) and deleted_at=now() (so
// the goals page's .is('deleted_at', null) filter drops it from the list).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body: { goal_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const goalId = body?.goal_id
  if (typeof goalId !== 'string' || goalId.length === 0) {
    return NextResponse.json({ error: 'goal_id is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('goals')
    .update({ deleted_at: new Date().toISOString(), status: 'deleted' })
    .eq('id', goalId)
    .eq('user_id', user.id)

  if (error) {
    console.error('[goals/delete] update error:', error)
    return NextResponse.json({ error: 'Failed to delete goal' }, { status: 500 })
  }

  // Soft-delete here does not fire the FK's ON DELETE SET NULL, so unlink
  // any action items still pointing at this goal. They survive (the heuristic
  // ranking can still place them via category fallback) but no longer claim
  // to serve a goal that's gone.
  const { error: unlinkError } = await supabase
    .from('action_items')
    .update({ goal_id: null })
    .eq('user_id', user.id)
    .eq('goal_id', goalId)

  if (unlinkError) {
    console.error('[goals/delete] action_items unlink error:', unlinkError)
  }

  return NextResponse.json({ success: true })
}
