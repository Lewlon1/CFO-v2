import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  persistRealValueClassifications,
  runMerchantLearning,
  VALID_QUADRANTS,
  type Quadrant,
} from '@/lib/value-map/persist-real-classification'

// ─────────────────────────────────────────────────────────────────────────
// POST /api/value-map/classify
//
// The value-first onboarding flow (value-map-flow.tsx) classifies the user's
// REAL flagged transactions. This endpoint runs the identical learning
// persistence as the personal retake route via the shared
// persistRealValueClassifications — so a real-transaction classification gets
// the same treatment regardless of which surface it came from: weighted
// correction_signals, a synchronous merchant value_category_rules row,
// a hard transaction confirm, fresh snapshots, and async processSignals per
// merchant followed by one full VM-2 rescoreValueCategories pass.
//
// Onboarding-specific bookkeeping (value_map_sessions, value_map_results,
// cut_intent) stays with the client flow, which also drives the post-Value-Map
// recompose. This route owns ONLY the learning persistence. Signals use weight
// 1.0 (a first-time call, not a 2x retake correction); the archetype is NOT
// regenerated here — the onboarding recompose delivers the reading.
// ─────────────────────────────────────────────────────────────────────────

const ONBOARDING_WEIGHT_MULTIPLIER = 1.0

type IncomingResult = {
  transaction_id: string
  quadrant: Quadrant | null
  confidence?: number
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { results?: IncomingResult[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const results = Array.isArray(body.results) ? body.results : []
  // Skip rows with a missing/invalid quadrant ("Unsure" arrives as null).
  const actionable = results.filter(
    (r) => r.transaction_id && r.quadrant && VALID_QUADRANTS.has(r.quadrant),
  ) as Array<IncomingResult & { quadrant: Quadrant }>

  if (actionable.length === 0) {
    return NextResponse.json({
      success: true,
      classified: 0,
      merchants_affected: 0,
      message: 'Nothing to save — all transactions skipped.',
    })
  }

  let merchantsAffected: string[]
  try {
    const persisted = await persistRealValueClassifications(
      supabase,
      user.id,
      actionable,
      { weightMultiplier: ONBOARDING_WEIGHT_MULTIPLIER },
    )
    merchantsAffected = persisted.merchantsAffected
  } catch (err) {
    console.error('[api/value-map/classify] persistence failed:', err)
    return NextResponse.json({ error: 'Could not save classifications' }, { status: 500 })
  }

  // Async learning — recompute rules per merchant + one full VM-2 re-score. No
  // archetype regen: the onboarding recompose delivers the post-sort reading.
  after(async () => {
    await runMerchantLearning(user.id, merchantsAffected)
  })

  return NextResponse.json({
    success: true,
    classified: actionable.length,
    merchants_affected: merchantsAffected.length,
  })
}
