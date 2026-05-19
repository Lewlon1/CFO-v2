import { createClient } from '@/lib/supabase/server'
import { computeFirstInsight } from '@/lib/analytics/insight-engine'
import { isChatIntelligenceV2Enabled } from '@/lib/features/chat-intelligence-v2'
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

  // Idempotency: if a FRESH first_insight conversation already exists (zero
  // messages, so the auto-trigger has not fired yet), return it. A stale one
  // with messages from a prior session would suppress the wow-moment trigger
  // (ChatProvider only auto-triggers on empty conversations), leaving the
  // user staring at unrelated history — so mark any stale rows completed and
  // fall through to create a fresh conversation.
  const { data: candidates } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('type', 'first_insight')
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

  // Session v2.2 Chat Intelligence cohort users skip the expensive
  // computeFirstInsight() pre-compute — the v2 prompt does not read
  // first_insight_payload and instead has the LLM pull numbers via the 10
  // detective tools. The conversation is still created (and the office
  // expects it) but with no payload attached.
  const { data: cohortProfile } = await supabase
    .from('user_profiles')
    .select('beta_cohort')
    .eq('id', user.id)
    .maybeSingle()
  const v2Enabled = isChatIntelligenceV2Enabled(cohortProfile)

  const payload = v2Enabled ? null : await computeFirstInsight(supabase, user.id)

  // Create the first_insight conversation. Metadata omits the payload entirely
  // for v2 users so downstream code can disambiguate "no payload yet" from
  // "payload is null" cleanly.
  const metadata: Record<string, unknown> = {
    import_batch_id: importBatchId,
  }
  if (payload) {
    metadata.first_insight_payload = payload
    metadata.transaction_count = payload.transactionCount
  } else {
    metadata.chat_intelligence_v2 = true
  }

  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      type: 'first_insight',
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
