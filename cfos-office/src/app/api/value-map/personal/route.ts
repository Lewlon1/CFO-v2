import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkLlmAllowed, LLM_LIMIT_MESSAGE } from '@/lib/ai/llm-guard'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { selectRetakeCandidates } from '@/lib/value-map/retake-candidates'
import {
  persistRealValueClassifications,
  runMerchantLearning,
  VALID_QUADRANTS,
} from '@/lib/value-map/persist-real-classification'
import { regenerateArchetype } from '@/lib/value-map/regenerate-archetype'
import { markOnboardingCompleteIfReady } from '@/lib/onboarding/markComplete'

const RETAKE_WEIGHT_MULTIPLIER = 2.0

type IncomingResult = {
  transaction_id: string
  quadrant: 'foundation' | 'investment' | 'burden' | 'leak' | null
  confidence?: number
  first_tap_ms?: number | null
  card_time_ms?: number
  deliberation_ms?: number
  hard_to_decide?: boolean
}

type PersonalRetakePayload = {
  results?: IncomingResult[]
  personalityType?: string
  dominantQuadrant?: string
  breakdown?: Record<string, { total: number; percentage: number; count: number }>
  merchantsByQuadrant?: Record<string, string[]>
}

// ─────────────────────────────────────────────────────────────────────────
// GET — fetch retake candidates
// ─────────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // Fetch user currency (default EUR)
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .single()
  const currency = profile?.primary_currency ?? 'EUR'

  try {
    const result = await selectRetakeCandidates(supabase, user.id)

    if (!result.ok) {
      return NextResponse.json(
        {
          available: false,
          reason: result.reason,
          stats: result.stats,
        },
        { status: 404 },
      )
    }

    // Override currency with user's actual currency
    const transactions = result.transactions.map((t) => ({
      ...t,
      currency,
    }))

    return NextResponse.json({
      available: true,
      transactions,
      stats: result.stats,
      currency,
    })
  } catch (err) {
    console.error('[api/value-map/personal GET] error:', err)
    return NextResponse.json(
      { available: false, reason: 'server_error' },
      { status: 500 },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST — save retake, emit weighted signals, trigger learning + archetype
// ─────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // LLM cost guard — the retake's after() hook regenerates the archetype
  // (Bedrock), so this route shares the archetype surface's caps.
  const guardVerdict = await checkLlmAllowed({ userId: user.id, surface: 'archetype', supabase })
  if (!guardVerdict.allowed) {
    console.warn(`[value-map-personal] llm-guard blocked user ${user.id}: ${guardVerdict.reason}`)
    return NextResponse.json({ error: 'limit', message: LLM_LIMIT_MESSAGE }, { status: 429 })
  }

  let body: PersonalRetakePayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const results = Array.isArray(body.results) ? body.results : []
  // Skip rows with a missing/invalid quadrant. hard_to_decide is retained as a
  // signal on value_map_results, not a filter — a hard call is still a call.
  const actionable = results.filter(
    (r) =>
      r.transaction_id &&
      r.quadrant &&
      VALID_QUADRANTS.has(r.quadrant),
  ) as Array<IncomingResult & { quadrant: 'foundation' | 'investment' | 'burden' | 'leak' }>

  if (!body.personalityType || !body.dominantQuadrant || !body.breakdown) {
    return NextResponse.json(
      { error: 'Missing personalityType, dominantQuadrant, or breakdown' },
      { status: 400 },
    )
  }

  if (actionable.length === 0) {
    return NextResponse.json({
      success: true,
      retake_id: null,
      classified: 0,
      merchants_affected: 0,
      message: 'Nothing to save — all transactions skipped.',
    })
  }

  // 1. Fetch transaction details in one query (RLS via user_id filter)
  const ids = actionable.map((r) => r.transaction_id)
  const { data: transactions, error: fetchError } = await supabase
    .from('transactions')
    .select('id, description, date, amount, category_id')
    .eq('user_id', user.id)
    .in('id', ids)

  if (fetchError) {
    console.error('[api/value-map/personal] fetch error:', fetchError)
    return NextResponse.json({ error: 'Could not load transactions' }, { status: 500 })
  }

  const txnMap = new Map(
    (transactions ?? []).map((t) => [t.id, t]),
  )

  // 2. Count existing sessions to compute next session_number (serves as version)
  const { count: existingSessions } = await supabase
    .from('value_map_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', user.id)

  const nextSessionNumber = (existingSessions ?? 0) + 1

  // 3. Create session row with type='personal'
  const { data: session, error: sessionError } = await supabase
    .from('value_map_sessions')
    .insert({
      profile_id: user.id,
      session_number: nextSessionNumber,
      type: 'personal',
      personality_type: body.personalityType,
      dominant_quadrant: body.dominantQuadrant,
      breakdown: body.breakdown,
      transaction_count: actionable.length,
      is_real_data: true,
      merchants_by_quadrant: body.merchantsByQuadrant ?? {},
      trigger_reason: 'retake_complete',
    })
    .select('id, created_at')
    .single()

  if (sessionError || !session) {
    console.error('[api/value-map/personal] session insert error:', sessionError)
    return NextResponse.json({ error: 'Could not create session' }, { status: 500 })
  }

  // Permissive onboarding completion — fire-and-forget.
  markOnboardingCompleteIfReady(supabase, user.id).catch((err) => {
    console.error('[value-map/personal] markOnboardingCompleteIfReady failed:', err)
  })

  // 4. Persist per-card results to value_map_results
  const resultRows = actionable
    .map((r) => {
      const txn = txnMap.get(r.transaction_id)
      if (!txn) return null
      return {
        profile_id: user.id,
        transaction_id: r.transaction_id,
        quadrant: r.quadrant,
        merchant: normaliseMerchant(txn.description) || txn.description || 'Unknown',
        amount: Number(txn.amount),
        confidence: r.confidence ?? 3,
        hard_to_decide: r.hard_to_decide ?? false,
        first_tap_ms: r.first_tap_ms ?? null,
        card_time_ms: r.card_time_ms ?? null,
        deliberation_ms: r.deliberation_ms ?? null,
        cut_intent: null,
        session_id: session.id,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (resultRows.length > 0) {
    const { error: resultsError } = await supabase
      .from('value_map_results')
      .insert(resultRows)
    if (resultsError) {
      console.error('[api/value-map/personal] results insert error:', resultsError)
      // non-fatal — session and signals still proceed
    }
  }

  // 5. Shared persistence: weighted correction_signals + synchronous merchant
  //    rule + transaction confirm + snapshot refresh. Same path as the
  //    value-first onboarding flow (/api/value-map/classify) — one source of
  //    truth for "the user classified these real transactions".
  let merchantsAffected: string[]
  try {
    const persisted = await persistRealValueClassifications(
      supabase,
      user.id,
      actionable,
      { weightMultiplier: RETAKE_WEIGHT_MULTIPLIER },
    )
    merchantsAffected = persisted.merchantsAffected
  } catch (err) {
    console.error('[api/value-map/personal] persistence failed:', err)
    return NextResponse.json({ error: 'Could not save classifications' }, { status: 500 })
  }

  // 6. Log completion event for observability
  void supabase.from('user_events').insert({
    profile_id: user.id,
    event_type: 'value_map_personal_completed',
    event_category: 'value_classification',
    payload: {
      session_id: session.id,
      classified: actionable.length,
      merchants_affected: merchantsAffected.length,
      personality_type: body.personalityType,
    },
  })

  // 7. Trigger async learning — runMerchantLearning is the single reconciled
  //    path: processSignals per merchant, then one full VM-2 re-score so the
  //    refreshed rule set reaches ALL history. Then regenerate the archetype,
  //    once every merchant's rules have settled.
  after(async () => {
    await runMerchantLearning(user.id, merchantsAffected)
    try {
      await regenerateArchetype(supabase, user.id, 'retake_complete')
    } catch (err) {
      console.error('[retake] regenerateArchetype failed:', err)
    }
  })

  return NextResponse.json({
    success: true,
    retake_id: session.id,
    classified: actionable.length,
    merchants_affected: merchantsAffected.length,
  })
}
