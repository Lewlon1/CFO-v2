import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { composeFirstRead } from '@/lib/ai/compose-first-read'
import { computeDeltas, toVerificationJson } from '@/lib/onboarding-v2/estimates/deltas'
import { fetchBandActuals } from '@/lib/onboarding-v2/estimates/reality-actuals'
import type {
  EstimateBands,
  HousingBandId,
  SubsBandId,
  BillsBandId,
  FoodOutBandId,
  SaveReachBandId,
} from '@/lib/onboarding-v2/estimates/bands'
import { NextResponse } from 'next/server'

/**
 * Reality-check Read delivery (OB-3). The post-completion statement-check
 * mission has just imported a real month and confirmed the fixed costs. This
 * route:
 *   1. refreshes merchant_aggregates (so the behavioural engine sees the import),
 *   2. loads the band sketch + fetches the real actuals → computeDeltas →
 *      persists onboarding_estimates.verification,
 *   3. composes the reality-check Read (mode 'reality_check'), and
 *   4. APPENDS it as a follow-up assistant message onto the SAME estimate-read
 *      conversation, stamping reality_check_metadata.
 *
 * It does NOT advance onboarding_step — the OnboardingBeatHost stamps
 * reality_check_delivered after this returns, then hands the Read into the sheet
 * (mirroring the estimate-beat-host race-safe pattern). The reality-check Read
 * closes on [CTA:start_value_map_real], converging into the VM-3 → recompose arc.
 *
 * Idempotent: a retry after the message landed returns the existing conversation.
 */

const isHousing = (v: string | null): v is HousingBandId =>
  v === 'a' || v === 'b' || v === 'c' || v === 'd'
const isSubs = (v: string | null): v is SubsBandId => v === 'low' || v === 'mid' || v === 'high'
const isBills = (v: string | null): v is BillsBandId => v === 'a' || v === 'b' || v === 'c'
const isFoodOut = (v: string | null): v is FoodOutBandId => v === 'a' || v === 'b' || v === 'c'
const isSaveReach = (v: string | null): v is SaveReachBandId =>
  v === 'a' || v === 'b' || v === 'c' || v === 'd'

type BandRow = {
  housing_band: string | null
  subs_band: string | null
  bills_band: string | null
  food_out_band: string | null
  save_reach_band: string | null
}

/** Map the text band columns to the typed EstimateBands, or null if any is
 *  missing / out of range (the delta engine needs all five). */
function toBands(row: BandRow | null): EstimateBands | null {
  if (!row) return null
  const { housing_band, subs_band, bills_band, food_out_band, save_reach_band } = row
  if (
    !isHousing(housing_band) ||
    !isSubs(subs_band) ||
    !isBills(bills_band) ||
    !isFoodOut(food_out_band) ||
    !isSaveReach(save_reach_band)
  ) {
    return null
  }
  return {
    housing: housing_band,
    subs: subs_band,
    bills: bills_band,
    foodOut: food_out_band,
    saveReach: save_reach_band,
  }
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = user.id
  const svc = createServiceClient()

  // Find the estimate-read conversation — the reality-check Read appends here so
  // the user reads estimate → reality in one thread. Deliberately NO
  // .neq('status','completed') filter (unlike post-upload / estimate-read, which
  // create new conversations): we must append to THIS thread even if the chat
  // pipeline marked it completed in the gap between the estimate Read and the
  // statement check. estimate_read=true is unique per user, so most-recent wins.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('type', 'first_read')
    .eq('metadata->>estimate_read', 'true')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conversation) {
    return NextResponse.json(
      { error: 'No estimate-read conversation to append to' },
      { status: 404 },
    )
  }

  const prevMeta = (conversation.metadata as Record<string, unknown> | null) ?? {}

  // Idempotency, two guards:
  //  (1) fast path — the reality_check_metadata marker is set.
  //  (2) robust path — count the conversation's assistant messages. The
  //      estimate-read thread has exactly ONE assistant message (the estimate
  //      Read) until the reality-check appends a second. Guarding on the count
  //      survives a metadata-write failure (message appended, marker not) that
  //      the marker-only guard would miss — that combination would otherwise
  //      double-append the Read on retry.
  if (prevMeta.reality_check_metadata) {
    return NextResponse.json({ conversationId: conversation.id, reused: true })
  }
  const { count: assistantCount } = await svc
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('role', 'assistant')
  if ((assistantCount ?? 0) >= 2) {
    return NextResponse.json({ conversationId: conversation.id, reused: true })
  }

  // 1. Refresh merchant_aggregates so the behavioural engine sees the freshly
  //    imported statement (mirrors post-upload). Non-fatal on error.
  const refresh = await svc.rpc('refresh_merchant_aggregates')
  if (refresh.error) {
    console.error('[reality-check] refresh_merchant_aggregates failed:', refresh.error)
  }

  // 2. Load the band sketch, fetch the real actuals, compute + persist deltas.
  const { data: estRow } = await svc
    .from('onboarding_estimates')
    .select('housing_band, subs_band, bills_band, food_out_band, save_reach_band')
    .eq('user_id', userId)
    .maybeSingle()
  const bands = toBands(estRow as BandRow | null)
  if (!bands) {
    // Degenerate — a check-mission user always has a complete OB-2 sketch. Warn
    // for ops, and return a 422 distinct from the 500 retry path so the host can
    // tell "user data incomplete" from "transient failure" if it ever surfaces.
    console.warn('[reality-check] incomplete band sketch for user', userId)
    return NextResponse.json(
      { error: 'Incomplete band sketch — estimates required to verify' },
      { status: 422 },
    )
  }

  const actuals = await fetchBandActuals(svc, userId)
  const deltas = computeDeltas(bands, actuals)

  const { error: verifyError } = await svc
    .from('onboarding_estimates')
    .update({ verification: toVerificationJson(deltas) })
    .eq('user_id', userId)
  if (verifyError) {
    console.error('[reality-check] persist verification failed:', verifyError)
    // Non-fatal: the Read still composes from the in-memory deltas.
  }

  // 3. Compose the reality-check Read.
  let composed: Awaited<ReturnType<typeof composeFirstRead>>
  try {
    composed = await composeFirstRead({ userId, supabase: svc, mode: 'reality_check', deltas })
  } catch (err) {
    console.error('[reality-check] composeFirstRead failed:', err)
    return NextResponse.json({ error: 'Failed to compose reality-check read' }, { status: 500 })
  }

  // 4. Append the Read as a follow-up assistant message on the estimate-read
  //    conversation (service client — messages RLS may reject role='assistant').
  const { error: msgError } = await svc.from('messages').insert({
    conversation_id: conversation.id,
    user_id: userId,
    role: 'assistant',
    content: composed.composedMessage,
  })
  if (msgError) {
    console.error('[reality-check] message insert failed:', msgError)
    return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 })
  }

  // Stamp reality_check_metadata so the recompose route's do-not-restate contract
  // sees BOTH prior Reads. Non-fatal on error: the message already landed and the
  // assistant-message-count guard above keeps a retry from double-appending; a
  // failed write only costs the recompose its merchant-exclusion list.
  const { error: metaError } = await supabase
    .from('conversations')
    .update({
      metadata: { ...prevMeta, reality_check_metadata: composed.metadata },
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
  if (metaError) {
    console.error('[reality-check] metadata update failed (non-fatal):', metaError)
  }

  return NextResponse.json({ conversationId: conversation.id, message_persisted: true })
}
