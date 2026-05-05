import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { composeEvidencePool } from '@/lib/experiments/candidate-engine'
import { classifyTier } from '@/lib/experiments/tier-classifier'
import { authorWowMoment } from '@/lib/experiments/wow-author'
import { signV3Payload } from '@/lib/experiments/candidate-token'

// First-insight endpoint for the onboarding modal — Wow Moment v3.
//
// Pipeline:
//   1. Compose the evidence pool (v3 detectors + legacy + gap-analyser),
//      enriched with comparative-scale context.
//   2. Classify the tier (showstopper / reframe / honest tease).
//   3. Opus authors all four beats grounded by the chosen evidence's
//      verifiable_claims.
//   4. Sign a v3 payload so save-experiment writes the exact authored
//      moment the user accepts.

const NARRATIVE_FALLBACK =
  "I've started looking through your numbers. Let's dig in together when you've got a minute."

export async function POST() {
  const startedAt = Date.now()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) {
    console.error('[generate-insight] missing SUPABASE_SERVICE_ROLE_KEY')
    return NextResponse.json({ insight: { narrative: NARRATIVE_FALLBACK } })
  }

  const serviceClient = createServiceClient()

  function logGenerated(extras: Record<string, unknown>) {
    console.log(
      '[wow_generated]',
      JSON.stringify({
        event: 'wow_generated',
        userId: user!.id,
        latency_ms: Date.now() - startedAt,
        ...extras,
      }),
    )
  }

  // 1. Evidence pool + tier classification.
  let composed
  try {
    composed = await composeEvidencePool(user.id, serviceClient)
  } catch (err) {
    console.error('[generate-insight] evidence pool failed:', err)
    logGenerated({ outcome: 'pool_error', tier: null })
    return NextResponse.json({ insight: { narrative: NARRATIVE_FALLBACK } })
  }

  // Lifetime block: a prior experiment exists. Render an honest narrative
  // (no four beats) — the user already had their wow moment.
  if (composed.hasPriorExperiment) {
    logGenerated({ outcome: 'lifetime_block', tier: null })
    return NextResponse.json({ insight: { narrative: NARRATIVE_FALLBACK } })
  }

  const classification = classifyTier(composed.pool, composed.dataDepth)

  // Tier 3 with no evidence at all = render an honest fallback narrative
  // without an Opus call. Saves cost and avoids LLM hallucination on thin data.
  if (classification.tier === 'tier_3' && !classification.evidence) {
    logGenerated({
      outcome: 'tier3_no_evidence',
      tier: 'tier_3',
      pool_size: composed.pool.length,
      data_days: composed.dataDepth.days,
      data_tx_count: composed.dataDepth.txCount,
    })
    return NextResponse.json({
      insight: {
        narrative:
          "You've shared a small amount of data so far — not enough to read patterns yet. Send me a couple more statements and I'll have something concrete to say.",
      },
    })
  }

  // Tier 1/2/3 with evidence → Opus authors all four beats.
  let authored
  try {
    authored = await authorWowMoment({
      evidence: classification.evidence!, // safe: tier_3-no-evidence path returned above
      supporting: classification.supporting,
      tier: classification.tier,
      user: {
        display_name: composed.context.display_name,
        archetype: composed.context.archetype,
        certainty_areas: composed.context.certainty_areas,
        conflict_areas: composed.context.conflict_areas,
        currency: composed.context.currency,
      },
      dataDepth: composed.dataDepth,
    })
  } catch (err) {
    console.error('[generate-insight] author failed:', err)
    logGenerated({
      outcome: 'author_error',
      tier: classification.tier,
      evidence_source: classification.evidence?.source,
    })
    return NextResponse.json({ insight: { narrative: NARRATIVE_FALLBACK } })
  }

  // 4. Sign a v3 candidate token for save-experiment.
  const evidence = classification.evidence!
  const noticingTarget = pickNoticingTarget(evidence) ?? evidence.source

  const tokenPayload = {
    v: 3 as const,
    evidence_id: evidence.evidence_id,
    tier: classification.tier,
    legacy_observation_type: evidence.legacy_observation_type,
    source: evidence.source,
    observed: authored.result.observed,
    named: authored.result.named,
    asked: authored.result.asked,
    proposed: authored.result.proposed,
    noticing_target: noticingTarget,
    payload: {
      evidence_id: evidence.evidence_id,
      source: evidence.source,
      headline: evidence.headline,
      wow_score: evidence.wow_score,
      tier: classification.tier,
      context_facts: evidence.context_facts,
    },
    used_fallback: authored.used_fallback,
    ts: Date.now(),
  }
  const candidate_token = signV3Payload(tokenPayload, secret)

  logGenerated({
    outcome: 'authored',
    tier: classification.tier,
    evidence_source: evidence.source,
    evidence_id: evidence.evidence_id,
    wow_score: evidence.wow_score,
    used_fallback: authored.used_fallback,
    pool_size: composed.pool.length,
    data_days: composed.dataDepth.days,
    data_tx_count: composed.dataDepth.txCount,
  })

  return NextResponse.json({
    insight: {
      observed: authored.result.observed,
      named: authored.result.named,
      asked: authored.result.asked,
      proposed: authored.result.proposed,
      narrative: authored.result.observed,
      candidate_token,
    },
    meta: {
      tier: classification.tier,
      evidence_source: evidence.source,
      used_fallback: authored.used_fallback,
    },
  })
}

function pickNoticingTarget(evidence: { verifiable_claims: { kind: string; value: string | number }[] }): string | null {
  const merchant = evidence.verifiable_claims.find((c) => c.kind === 'merchant')
  if (merchant) return String(merchant.value)
  return null
}
