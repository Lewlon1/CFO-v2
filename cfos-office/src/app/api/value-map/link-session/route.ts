// Links an anonymous demo session to a newly created account.
// Copies data from demo_sessions → value_map_results (per-card rows) +
// value_map_sessions (summary) and seeds value_category_rules.
//
// DB schema note: value_map_results uses profile_id (FK to profiles), not user_id.
// value_map_sessions also uses profile_id. value_category_rules uses user_id.
// Both profile_id and user_id reference auth.users.id — same UUID.
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'
import type { ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'
import { calculatePersonality } from '@/lib/value-map/personalities'

export async function POST(request: Request) {
  const { session_token } = await request.json()

  // Auth check uses the user's session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!session_token) return NextResponse.json({ error: 'Missing session_token' }, { status: 400 })

  // Use service client to read demo_sessions (no RLS policy for authenticated users)
  const service = createServiceClient()

  const { data: session, error: sessionError } = await service
    .from('demo_sessions')
    .select('id, session_token, responses, ai_response_shown')
    .eq('session_token', session_token)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ success: true, linked: false })
  }

  // demo_sessions.responses is stored as { results: ValueMapResult[], elapsed_seconds: number }
  const rawResponses = session.responses as { results?: ValueMapResult[] } | ValueMapResult[] | null
  const responses: ValueMapResult[] | null = Array.isArray(rawResponses)
    ? rawResponses
    : (rawResponses?.results ?? null)
  if (!responses || responses.length === 0) {
    return NextResponse.json({ success: true, linked: false })
  }

  // Calculate personality from responses
  const personality = calculatePersonality(responses)
  const dominantQuadrant = (Object.entries(personality.breakdown) as [string, { percentage: number }][])
    .sort((a, b) => b[1].percentage - a[1].percentage)[0][0]

  // Build merchants_by_quadrant lookup
  const merchantsByQuadrant: Record<string, string[]> = {}
  for (const r of responses) {
    if (r.quadrant) {
      if (!merchantsByQuadrant[r.quadrant]) merchantsByQuadrant[r.quadrant] = []
      if (!merchantsByQuadrant[r.quadrant].includes(r.merchant)) {
        merchantsByQuadrant[r.quadrant].push(r.merchant)
      }
    }
  }

  // Count existing sessions to determine session_number
  const { count: existingSessions } = await service
    .from('value_map_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', user.id)

  // Create session summary in value_map_sessions (matches in-app Value Map pattern)
  const { data: vmSession } = await service
    .from('value_map_sessions')
    .insert({
      profile_id: user.id,
      session_number: (existingSessions ?? 0) + 1,
      personality_type: personality.personality,
      dominant_quadrant: dominantQuadrant,
      breakdown: personality.breakdown,
      transaction_count: responses.length,
      is_real_data: false, // demo uses sample transactions
      merchants_by_quadrant: merchantsByQuadrant,
    })
    .select('id')
    .single()

  const sessionId = vmSession?.id ?? null

  // Insert per-card results into value_map_results (one row per card)
  const resultRows = responses.map(r => ({
    profile_id: user.id,
    transaction_id: r.transaction_id,
    quadrant: r.quadrant,
    merchant: r.merchant,
    amount: r.amount,
    confidence: r.confidence,
    hard_to_decide: r.hard_to_decide ?? false,
    first_tap_ms: r.first_tap_ms,
    card_time_ms: r.card_time_ms,
    deliberation_ms: r.deliberation_ms,
    cut_intent: null,
    session_id: sessionId,
  }))

  const { error: resultsError } = await service
    .from('value_map_results')
    .insert(resultRows)

  if (resultsError) {
    console.error('[link-session] value_map_results insert error:', resultsError)
  }

  // Seed value_category_rules from quadrant assignments
  const decided = responses.filter(
    (r): r is ValueMapResult & { quadrant: ValueQuadrant } => r.quadrant !== null
  )

  if (decided.length > 0) {
    const rules = decided.map(r => ({
      user_id: user.id,
      match_type: 'merchant' as const,
      match_value: r.merchant.toLowerCase(),
      value_category: r.quadrant,
      confidence: r.confidence / 5, // Convert 1-5 scale to 0-1
      source: 'value_map',
      last_signal_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    const { error: rulesError } = await service
      .from('value_category_rules')
      .upsert(rules, { onConflict: 'user_id,match_type,match_value,coalesce(time_context,\'__none__\')' })

    if (rulesError) {
      console.error('[link-session] value_category_rules seed error:', rulesError)
    }
  }

  // Track analytics event (non-critical, ignore errors)
  await service.from('user_events').insert({
    user_id: user.id,
    event_name: 'value_map_session_linked',
    metadata: { session_token, card_count: responses.length },
  })

  return NextResponse.json({ success: true, linked: true })
}
