import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyCandidateToken } from '@/lib/experiments/candidate-token'
import { nextSundayAt } from '@/lib/experiments/scheduling'

// Persists the wow moment as the user's active_experiment when they tap the
// CTA in the onboarding modal. The route receives a signed candidate_token
// (issued by /api/onboarding/generate-insight) so the stored row reflects
// exactly what the user saw, without keeping pending state between calls.

interface SaveExperimentRequest {
  candidate_token?: string
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: SaveExperimentRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body?.candidate_token) {
    return NextResponse.json({ error: 'Missing candidate_token' }, { status: 400 })
  }

  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) {
    console.error('[save-experiment] missing SUPABASE_SERVICE_ROLE_KEY')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  let signed
  try {
    signed = verifyCandidateToken(body.candidate_token, secret)
  } catch (err) {
    console.error('[save-experiment] token verification failed:', err)
    return NextResponse.json({ error: 'Invalid candidate_token' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  // Defence-in-depth: lifetime block. The unique partial index also enforces
  // one active row at a time, but blocking on any prior row matches the
  // candidate engine's gate so the user can't smuggle a second wow moment
  // through after dismissing the first.
  const priorCheck = await serviceClient
    .from('active_experiments')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
  if (priorCheck.data && priorCheck.data.length > 0) {
    return NextResponse.json({ error: 'Experiment already exists for user' }, { status: 409 })
  }

  const now = new Date()
  const callbackDueAt = nextSundayAt(now, { hourUTC: 18, minDaysAhead: 1, maxDaysAhead: 7 })

  const insertResult = await serviceClient
    .from('active_experiments')
    .insert({
      user_id: user.id,
      conversation_id: null,
      observation_type: signed.candidate.observation_type,
      pattern_template_key: signed.candidate.pattern_template_key,
      pattern_name: signed.patternName,
      observation_payload: signed.candidate.payload,
      question: signed.question,
      experiment_text: signed.experimentText,
      noticing_target: signed.noticingTarget,
      status: 'active',
      proposed_at: now.toISOString(),
      accepted_at: now.toISOString(),
      callback_due_at: callbackDueAt.toISOString(),
    })
    .select('id')
    .single()

  if (insertResult.error) {
    console.error('[save-experiment] DB insert failed:', insertResult.error)
    return NextResponse.json({ error: 'Could not save experiment' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, experiment_id: insertResult.data?.id })
}
