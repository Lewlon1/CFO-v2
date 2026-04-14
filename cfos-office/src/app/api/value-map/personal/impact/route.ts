import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/value-map/personal/impact?retake_id=...
//
// Computes the impact of a personal retake:
// - confirmed_count: transactions the user explicitly categorised during the retake
// - propagated_count: transactions backfilled via merchant_rule since the retake
// - rules_learned: new value_category_rules with source='learned' created since retake
// - avg_confidence_after: current avg confidence for transactions of affected merchants

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const retakeId = req.nextUrl.searchParams.get('retake_id')
  if (!retakeId) {
    return NextResponse.json({ error: 'Missing retake_id' }, { status: 400 })
  }

  // 1. Fetch the session (verify ownership via RLS)
  const { data: session, error: sessionError } = await supabase
    .from('value_map_sessions')
    .select('id, profile_id, created_at, transaction_count, type')
    .eq('id', retakeId)
    .eq('profile_id', user.id)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Retake session not found' }, { status: 404 })
  }

  const sessionStart = session.created_at

  // 2. Confirmed count — transactions the user explicitly classified in the retake
  const { count: confirmedCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('prediction_source', 'user_confirmed')
    .gte('confirmed_at', sessionStart)

  // 3. Propagated count — transactions backfilled via merchant_rule since the retake
  // (updated_at column added in migration 033 if missing)
  const { count: propagatedCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('prediction_source', 'merchant_rule')
    .eq('value_confirmed_by_user', false)
    .gte('updated_at', sessionStart)

  // 4. Rules learned — new learned rules created since the retake
  const { count: rulesLearned } = await supabase
    .from('value_category_rules')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('source', 'learned')
    .gte('updated_at', sessionStart)

  // 5. Current high-confidence % across all unconfirmed transactions (trust calibrator)
  // This is a proxy for "how much of the Values View is now well-categorised."
  const { data: confidenceData } = await supabase
    .from('transactions')
    .select('value_confidence, value_confirmed_by_user')
    .eq('user_id', user.id)
    .not('value_confidence', 'is', null)

  const rows = (confidenceData ?? []) as Array<{
    value_confidence: number | null
    value_confirmed_by_user: boolean | null
  }>
  const total = rows.length
  const highConfidence = rows.filter(
    (r) => r.value_confirmed_by_user === true || (r.value_confidence ?? 0) >= 0.7,
  ).length
  const highConfidencePct = total > 0 ? Math.round((highConfidence / total) * 100) : 0

  return NextResponse.json({
    retake_id: retakeId,
    confirmed_count: confirmedCount ?? 0,
    propagated_count: propagatedCount ?? 0,
    rules_learned: rulesLearned ?? 0,
    high_confidence_pct: highConfidencePct,
    session_created_at: sessionStart,
    transaction_count: session.transaction_count,
  })
}
