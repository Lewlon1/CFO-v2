import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeFirstInsight } from '@/lib/analytics/insight-engine'
import { isChatIntelligenceV2Enabled } from '@/lib/features/chat-intelligence-v2'
import { isLayeredReadEnabled } from '@/lib/feature-flags/layered-read'
import { composeFirstRead, type ComposeFirstReadMode } from '@/lib/ai/compose-first-read'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Body is optional — onboarding-v2 archetype calls this with no payload.
  let importBatchId: string | null = null
  try {
    const body = await req.json()
    importBatchId = body?.importBatchId ?? null
  } catch {
    // No JSON body — that's fine.
  }

  // Session 32 (B): Layered Read path. Pre-composes the first Read as an
  // assistant message so the ChatProvider auto-trigger does NOT fire (it
  // gates on msgs.length === 0). Composition metadata is persisted on the
  // conversation row so Session C's wow_assessment plumbing can read it.
  // Unflagged users continue down the V1/V2 narrate-via-trigger path below.
  if (isLayeredReadEnabled()) {
    // Value-first onboarding signal: the user has walked through the
    // processing + confirm screens, so their step has landed on
    // `details_confirmed`. The composer's value_first mode adds the HOOK
    // close + Layer 1 financial facts to the prompt. Other entry paths
    // (manual upload of a new statement, legacy archetype hop, etc.) get
    // the default composition.
    const { data: stepProfile } = await supabase
      .from('user_profiles')
      .select('onboarding_step')
      .eq('id', user.id)
      .maybeSingle()
    const mode: ComposeFirstReadMode =
      stepProfile?.onboarding_step === 'details_confirmed' ? 'value_first' : 'default'
    return handleLayeredFirstRead({ supabase, userId: user.id, importBatchId, mode })
  }

  // Idempotency: if a FRESH first_read conversation already exists (zero
  // messages, so the auto-trigger has not fired yet), return it. A stale one
  // with messages from a prior session would suppress the wow-moment trigger
  // (ChatProvider only auto-triggers on empty conversations), leaving the
  // user staring at unrelated history — so mark any stale rows completed and
  // fall through to create a fresh conversation.
  const { data: candidates } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('type', 'first_read')
    .neq('status', 'completed')
    .order('created_at', { ascending: false })

  if (candidates && candidates.length > 0) {
    const ids = candidates.map((c) => c.id)
    const { data: counts } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', ids)
    const idsWithMessages = new Set((counts ?? []).map((m) => m.conversation_id))

    const freshId = candidates.find((c) => !idsWithMessages.has(c.id))?.id ?? null
    const staleIds = candidates.filter((c) => idsWithMessages.has(c.id)).map((c) => c.id)

    if (staleIds.length > 0) {
      await supabase
        .from('conversations')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .in('id', staleIds)
    }

    if (freshId) {
      return NextResponse.json({ conversationId: freshId, reused: true })
    }
  }

  // Compute the deterministic insight payload for every user. V1 users
  // narrate from the full payload; V2 users only need the experiment
  // proposal (so we can include the required closing beat in the V2 brief)
  // but pattern detection + ranking happens the same way for both.
  const { data: cohortProfile } = await supabase
    .from('user_profiles')
    .select('beta_cohort')
    .eq('id', user.id)
    .maybeSingle()
  const v2Enabled = isChatIntelligenceV2Enabled(cohortProfile)

  const payload = await computeFirstInsight(supabase, user.id)

  const metadata: Record<string, unknown> = {
    import_batch_id: importBatchId,
  }
  if (v2Enabled) {
    metadata.chat_intelligence_v2 = true
    metadata.experiment_proposal = payload.experiment_proposal
  } else {
    metadata.first_insight_payload = payload
    metadata.transaction_count = payload.transactionCount
  }

  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      type: 'first_read',
      title: 'Your first look',
      metadata,
    })
    .select('id')
    .single()

  if (error || !conversation) {
    console.error('Failed to create first-insight conversation:', error)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }

  return NextResponse.json({ conversationId: conversation.id })
}

// ── Session 32 (B): Layered first Read path ──────────────────────────────
//
// One-shot composition: refresh the materialised view (so freshly-uploaded
// transactions are visible to the behavioural engine), run composeFirstRead
// to generate the message, persist conversation + pre-written assistant
// message in a single round-trip, return the conversationId. The pre-written
// message bypasses ChatProvider's auto-trigger (gated on msgs.length === 0).

type LayeredHandlerArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  importBatchId: string | null
  mode: ComposeFirstReadMode
}

async function handleLayeredFirstRead({ supabase, userId, importBatchId, mode }: LayeredHandlerArgs) {
  // Idempotency: if a layered first_read conversation already exists for
  // this user, return it. (Identified by metadata.layered_read = true, which
  // every layered run stamps.) Avoids double-composing if the upload
  // orchestrator calls /api/insights/post-upload twice.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'first_read')
    .eq('metadata->>layered_read', 'true')
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    return NextResponse.json({ conversationId: existing.id, reused: true, layered: true })
  }

  // Mark any stale (non-layered) typed conversations completed so the user's
  // list isn't cluttered when the new layered conversation appears.
  await supabase
    .from('conversations')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('type', 'first_read')
    .neq('status', 'completed')

  // Refresh merchant_aggregates so the behavioural engine sees the user's
  // freshly-imported transactions. The upload route also fires this
  // fire-and-forget; awaiting here ensures the MV is fresh by composition
  // time even when post-upload races the background refresh.
  const svc = createServiceClient()
  const refresh = await svc.rpc('refresh_merchant_aggregates')
  if (refresh.error) {
    console.error('[post-upload.layered] refresh_merchant_aggregates failed:', refresh.error)
    // Continue anyway — the MV may already have been refreshed by the upload
    // route. Composition will use whatever's in the MV.
  }

  let composed: Awaited<ReturnType<typeof composeFirstRead>>
  try {
    composed = await composeFirstRead({ userId, supabase: svc, mode })
  } catch (err) {
    console.error('[post-upload.layered] composeFirstRead failed:', err)
    return NextResponse.json({ error: 'Failed to compose first read' }, { status: 500 })
  }

  const conversationMetadata: Record<string, unknown> = {
    layered_read: true,
    import_batch_id: importBatchId,
    first_read_metadata: composed.metadata,
  }

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      type: 'first_read',
      title: 'Your first read',
      metadata: conversationMetadata,
    })
    .select('id')
    .single()

  if (convError || !conversation) {
    console.error('[post-upload.layered] conversation insert failed:', convError)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }

  // Pre-write the composed message so the auto-trigger guard skips firing.
  // Use the service client because the messages RLS policy may not let the
  // user's session insert messages with role='assistant' depending on policy.
  const { error: msgError } = await svc
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      user_id: userId,
      role: 'assistant',
      content: composed.composedMessage,
    })

  if (msgError) {
    console.error('[post-upload.layered] message insert failed:', msgError)
    // Soft-fail: return the conversation anyway. The ChatProvider will fall
    // through to its default "deliver your first insight" trigger.
    return NextResponse.json({ conversationId: conversation.id, layered: true, message_persisted: false })
  }

  return NextResponse.json({ conversationId: conversation.id, layered: true, message_persisted: true })
}
