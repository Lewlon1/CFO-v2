import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { cardConvictionToRuleConfidence } from '@/lib/categorisation/value-config'
import { rescoreValueCategories } from '@/lib/categorisation/value-rescore'
import {
  refreshMonthlySnapshots,
  extractAffectedMonths,
} from '@/lib/analytics/monthly-snapshot'
import { markOnboardingCompleteIfReady } from '@/lib/onboarding/markComplete'
import { calculatePersonality } from '@/lib/value-map/personalities'
import { computePaybackForUser } from '@/lib/value-map/payback'
import { isValueMapV2Enabled } from '@/lib/value-map/flags'
import { VCR_ON_CONFLICT } from '@/lib/prediction/types'
import type { ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'

// POST /api/value-map/onboarding — VM-3 post-Read card session save.
//
// The deterministic signal pipeline for the post-Read Value Map on the
// user's own transactions. Per answered card:
//   - one merchant rule at CARD_CONF_TO_RULE_CONF[conviction]
//   - the exemplar transaction is stamped user_confirmed
// "Unsure" answers write the value_map_results row only — no rule.
// Session completion AWAITS rescoreValueCategories (the payback screen
// renders from its result), then recomputes snapshots for the exemplars'
// months. ZERO LLM calls anywhere on this path — the first LLM touch in
// the VM arc is VM-4's archetype reveal, which is out of scope here.

const VALID_QUADRANTS = new Set(['foundation', 'investment', 'burden', 'leak'])

type IncomingResult = Pick<
  ValueMapResult,
  'transaction_id' | 'quadrant' | 'confidence' | 'hard_to_decide' | 'cut_intent'
> & {
  first_tap_ms?: number | null
  card_time_ms?: number
  deliberation_ms?: number
}

export async function POST(req: NextRequest) {
  // Flag OFF hides every entry point — including this one.
  if (!isValueMapV2Enabled()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

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
  if (results.length === 0) {
    return NextResponse.json({ error: 'No results' }, { status: 400 })
  }

  const actionable = results.filter(
    (r): r is IncomingResult & { quadrant: ValueQuadrant } =>
      Boolean(r.transaction_id) && r.quadrant !== null && VALID_QUADRANTS.has(r.quadrant ?? ''),
  )

  // 1. Load the transactions behind the cards (RLS-scoped).
  const ids = results.map((r) => r.transaction_id).filter(Boolean)
  const { data: transactions, error: fetchError } = await supabase
    .from('transactions')
    .select('id, description, date, amount, category_id')
    .eq('user_id', user.id)
    .in('id', ids)
  if (fetchError) {
    console.error('[value-map/onboarding] fetch error:', fetchError)
    return NextResponse.json({ error: 'Could not load transactions' }, { status: 500 })
  }
  const txnMap = new Map((transactions ?? []).map((t) => [t.id as string, t]))

  // 2. Session row. type='onboarding' + is_real_data=true is the established
  //    combination for the post-Read flow (Phase 0 audit, 0.7).
  const personality = calculatePersonality(results as ValueMapResult[])
  const dominantQuadrant = (
    Object.entries(personality.breakdown) as [string, { percentage: number }][]
  ).sort((a, b) => b[1].percentage - a[1].percentage)[0][0]

  const merchantsByQuadrant: Record<string, string[]> = {}
  for (const r of actionable) {
    const txn = txnMap.get(r.transaction_id)
    const merchant = normaliseMerchant(txn?.description ?? '') || 'unknown'
    const list = (merchantsByQuadrant[r.quadrant] ??= [])
    if (!list.includes(merchant)) list.push(merchant)
  }

  const { count: existingSessions } = await supabase
    .from('value_map_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', user.id)

  const { data: session, error: sessionError } = await supabase
    .from('value_map_sessions')
    .insert({
      profile_id: user.id,
      session_number: (existingSessions ?? 0) + 1,
      type: 'onboarding',
      personality_type: personality.personality,
      dominant_quadrant: dominantQuadrant,
      breakdown: personality.breakdown,
      transaction_count: results.length,
      is_real_data: true,
      merchants_by_quadrant: merchantsByQuadrant,
      trigger_reason: 'value_first_onboarding',
    })
    .select('id')
    .single()
  if (sessionError || !session) {
    console.error('[value-map/onboarding] session insert error:', sessionError)
    return NextResponse.json({ error: 'Could not create session' }, { status: 500 })
  }

  // Permissive onboarding completion — fire-and-forget.
  markOnboardingCompleteIfReady(supabase, user.id).catch((err) => {
    console.error('[value-map/onboarding] markOnboardingCompleteIfReady failed:', err)
  })

  // 3. Per-card result rows. Timing telemetry is stored here and ONLY here —
  //    it never renders in this flow's UI and never enters a prompt.
  const resultRows = results
    .map((r) => {
      const txn = txnMap.get(r.transaction_id)
      if (!txn) return null
      return {
        profile_id: user.id,
        transaction_id: r.transaction_id,
        quadrant: r.quadrant,
        merchant: normaliseMerchant(txn.description ?? '') || txn.description || 'Unknown',
        amount: Math.abs(Number(txn.amount)),
        confidence: r.confidence ?? 3,
        hard_to_decide: r.hard_to_decide ?? false,
        first_tap_ms: r.first_tap_ms ?? null,
        card_time_ms: r.card_time_ms ?? null,
        deliberation_ms: r.deliberation_ms ?? null,
        cut_intent: r.cut_intent ?? null,
        session_id: session.id,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
  if (resultRows.length > 0) {
    const { error: resultsError } = await supabase
      .from('value_map_results')
      .insert(resultRows)
    if (resultsError) {
      console.error('[value-map/onboarding] results insert error:', resultsError)
      // non-fatal — rules and re-score still proceed
    }
  }

  if (actionable.length === 0) {
    return NextResponse.json({
      success: true,
      session_id: session.id,
      classified: 0,
      payback: null,
    })
  }

  // 4. Merchant rules at the mapped conviction confidence. Real merchants →
  //    source='value_map_personal' (the established source for rules seeded
  //    from real-transaction VM cards, distinct from sample-card 'value_map').
  const nowIso = new Date().toISOString()
  const answeredMerchants = new Set<string>()
  const rules = actionable.flatMap((r) => {
    const txn = txnMap.get(r.transaction_id)
    const merchantClean = normaliseMerchant(txn?.description ?? '')
    if (!merchantClean) return []
    answeredMerchants.add(merchantClean)
    return [
      {
        user_id: user.id,
        match_type: 'merchant' as const,
        match_value: merchantClean,
        value_category: r.quadrant,
        confidence: cardConvictionToRuleConfidence(r.confidence ?? 3),
        source: 'value_map_personal',
        last_signal_at: nowIso,
        updated_at: nowIso,
      },
    ]
  })
  if (rules.length > 0) {
    const { error: rulesError } = await supabase
      .from('value_category_rules')
      .upsert(rules, { onConflict: VCR_ON_CONFLICT })
    if (rulesError) {
      console.error('[value-map/onboarding] rules upsert error:', rulesError)
    }
  }

  // 5. Exemplar transactions: the card itself is a direct user confirmation.
  const affectedDates: string[] = []
  for (const r of actionable) {
    const txn = txnMap.get(r.transaction_id)
    if (!txn) continue
    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        value_category: r.quadrant,
        value_confidence: 1.0,
        value_confirmed_by_user: true,
        prediction_source: 'user_confirmed',
        confirmed_at: nowIso,
      })
      .eq('id', r.transaction_id)
      .eq('user_id', user.id)
    if (!updateError) affectedDates.push(txn.date as string)
  }

  // 6. Retroactive re-score — AWAITED: the payback screen renders its result.
  //    (rescoreValueCategories refreshes snapshots for the months IT updated.)
  let rescore = { scanned: 0, updated: 0, affectedMonths: [] as string[] }
  try {
    const full = await rescoreValueCategories(user.id)
    rescore = {
      scanned: full.scanned,
      updated: full.updated,
      affectedMonths: full.affectedMonths,
    }
  } catch (err) {
    console.error('[value-map/onboarding] rescore failed:', err)
  }

  // 7. Snapshot recompute for the exemplars' own months (step 5 wrote them
  //    directly, outside the re-score's own refresh).
  if (affectedDates.length > 0) {
    try {
      await refreshMonthlySnapshots(supabase, user.id, extractAffectedMonths(affectedDates))
    } catch (err) {
      console.error('[value-map/onboarding] snapshot refresh failed:', err)
    }
  }

  // 8. Payback — fully computed, reconcilable against direct SQL to the cent.
  const payback = await computePaybackForUser(
    supabase,
    user.id,
    answeredMerchants,
    actionable.length,
  )

  // 9. Observability event.
  void supabase.from('user_events').insert({
    profile_id: user.id,
    event_type: 'value_map_onboarding_completed',
    event_category: 'value_classification',
    payload: {
      session_id: session.id,
      classified: actionable.length,
      merchants_affected: answeredMerchants.size,
      rescore_updated: rescore.updated,
      monthly_mapped: payback.monthlyMapped,
    },
  })

  return NextResponse.json({
    success: true,
    session_id: session.id,
    classified: actionable.length,
    rescore,
    payback,
  })
}
