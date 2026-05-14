import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logContribution } from '@/lib/goals/contributions'

export const dynamic = 'force-dynamic'

// POST /api/goals/contributions — log a manual contribution against a goal.
// Body: { goal_id: string, amount: number, note?: string }. Negative amounts
// are allowed (corrections/withdrawals). Triggers a per-goal recompute and
// returns the updated goal so the caller can re-render fresh numbers.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body: { goal_id?: unknown; amount?: unknown; note?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const goalId = body?.goal_id
  const amountRaw = body?.amount
  const note = body?.note

  if (typeof goalId !== 'string' || goalId.length === 0) {
    return NextResponse.json({ error: 'goal_id is required' }, { status: 400 })
  }
  const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw)
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: 'amount must be a non-zero number' }, { status: 400 })
  }
  if (note != null && typeof note !== 'string') {
    return NextResponse.json({ error: 'note must be a string if provided' }, { status: 400 })
  }
  if (typeof note === 'string' && note.length > 500) {
    return NextResponse.json({ error: 'note must be 500 characters or fewer' }, { status: 400 })
  }

  // Confirm the goal belongs to the user and is active.
  const { data: goal, error: lookupErr } = await supabase
    .from('goals')
    .select('id, status')
    .eq('id', goalId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (lookupErr) {
    console.error('[goals/contributions] goal lookup error:', lookupErr)
    return NextResponse.json({ error: 'Could not look up that goal' }, { status: 500 })
  }
  if (!goal) {
    return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  }
  if (goal.status !== 'active') {
    return NextResponse.json({ error: 'Goal is not active' }, { status: 400 })
  }

  try {
    const result = await logContribution(supabase, user.id, {
      goalId,
      amount: Math.round(amount),
      note: typeof note === 'string' ? note : null,
      kind: 'manual',
    })
    return NextResponse.json({ success: true, contribution: result.contribution, goal: result.goal })
  } catch (err) {
    console.error('[goals/contributions] log error:', err)
    return NextResponse.json({ error: 'Failed to log contribution' }, { status: 500 })
  }
}
