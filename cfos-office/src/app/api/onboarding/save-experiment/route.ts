import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyV3Token, verifyCandidateToken } from '@/lib/experiments/candidate-token'
import { nextSundayAt } from '@/lib/experiments/scheduling'

// Persists the wow moment as the user's active_experiment when they tap the
// CTA in the onboarding modal. The route receives a signed candidate_token
// (issued by /api/onboarding/generate-insight) so the stored row reflects
// exactly what the user saw, without keeping pending state between calls.
//
// v3 tokens carry the Opus-authored four beats and a derived payload. The
// legacy v2 verifier is retained for any in-flight tokens at the deploy
// boundary (a token issued under v2 just before deploy could be redeemed
// under v3 after deploy — accept both shapes for the first 24h).

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

  // Discriminate v3 vs v2 by the token prefix.
  let observationType: 'high_freq_merchant' | 'category_variance' | 'time_pattern'
  let patternTemplateKey: string
  let patternName: string
  let observationPayload: Record<string, unknown>
  let question: string
  let experimentText: string
  let noticingTarget: string

  try {
    if (body.candidate_token.startsWith('v3.')) {
      const signed = verifyV3Token(body.candidate_token, secret)
      observationType = signed.legacy_observation_type
      patternTemplateKey = signed.source
      patternName = signed.named
      observationPayload = {
        ...signed.payload,
        observed: signed.observed,
        named: signed.named,
        asked: signed.asked,
        proposed: signed.proposed,
        tier: signed.tier,
        used_fallback: signed.used_fallback,
      }
      question = signed.asked
      experimentText = signed.proposed
      noticingTarget = signed.noticing_target
    } else {
      const signed = verifyCandidateToken(body.candidate_token, secret)
      observationType = signed.candidate.observation_type
      patternTemplateKey = signed.candidate.pattern_template_key
      patternName = signed.patternName
      observationPayload = signed.candidate.payload
      question = signed.question
      experimentText = signed.experimentText
      noticingTarget = signed.noticingTarget
    }
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
      observation_type: observationType,
      pattern_template_key: patternTemplateKey,
      pattern_name: patternName,
      observation_payload: observationPayload,
      question,
      experiment_text: experimentText,
      noticing_target: noticingTarget,
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
