import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateWowMomentCandidate } from '@/lib/experiments/candidate-engine'
import { generateWowMoment } from '@/lib/experiments/wow-moment-generator'
import { signCandidatePayload } from '@/lib/experiments/candidate-token'

// First-insight endpoint for the onboarding modal — Wow Moment v2.
//
// Pipeline:
//   1. Detectors precompute every figure deterministically (lib/experiments).
//   2. Bedrock writes ONLY the [OBSERVED] beat 01 prose; beats 02/03/04 are
//      rendered from locked templates.
//   3. We don't insert into active_experiments here — the user has to accept
//      via /api/onboarding/save-experiment first. This way the modal can
//      preview without locking the user into an experiment they bail on.
//   4. The signed `candidate_token` lets the save route persist the exact
//      candidate the user saw without us storing pending state server-side.

const FALLBACK_NARRATIVE =
  "I've started looking through your numbers. Let's dig in together when you've got a minute."

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Service client bypasses RLS so detectors see everything they need
  // (transactions, value_map_sessions, future cross-user normalisation, etc).
  const serviceClient = createServiceClient()

  let candidate
  try {
    candidate = await generateWowMomentCandidate(user.id, serviceClient)
  } catch (err) {
    console.error('[generate-insight] candidate engine failed:', err)
    return NextResponse.json({ insight: { narrative: FALLBACK_NARRATIVE } })
  }

  if (!candidate) {
    return NextResponse.json({ insight: { narrative: FALLBACK_NARRATIVE } })
  }

  // Pull the user's display name + archetype for the prompt.
  const [profileResult, vmResult] = await Promise.all([
    serviceClient
      .from('user_profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle(),
    serviceClient
      .from('value_map_sessions')
      .select('archetype_name')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  try {
    const { wowMoment, experimentInsert } = await generateWowMoment(candidate, {
      display_name: profileResult.data?.display_name ?? null,
      archetype: vmResult.data?.archetype_name ?? null,
    })

    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!secret) {
      // Should never happen on a configured deployment, but bail safely if so.
      console.error('[generate-insight] missing SUPABASE_SERVICE_ROLE_KEY for token signing')
      return NextResponse.json({ insight: { narrative: FALLBACK_NARRATIVE } })
    }

    const candidate_token = signCandidatePayload(
      {
        candidate,
        patternName: experimentInsert.pattern_name,
        question: experimentInsert.question,
        experimentText: experimentInsert.experiment_text,
        noticingTarget: experimentInsert.noticing_target,
        ts: Date.now(),
      },
      secret,
    )

    return NextResponse.json({
      insight: {
        observed: wowMoment.observed,
        named: wowMoment.named,
        asked: wowMoment.asked,
        proposed: wowMoment.proposed,
        narrative: wowMoment.narrative,
        candidate_token,
      },
    })
  } catch (err) {
    console.error('[generate-insight] generation/validation failed:', err)
    return NextResponse.json({ insight: { narrative: FALLBACK_NARRATIVE } })
  }
}
