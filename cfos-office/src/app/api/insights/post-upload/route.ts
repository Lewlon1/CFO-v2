import { createClient } from '@/lib/supabase/server'
import { computeFirstInsight } from '@/lib/analytics/insight-engine'
import { isChatIntelligenceV2Enabled } from '@/lib/features/chat-intelligence-v2'
import { shouldGenerateHypothesisOnUpload } from '@/lib/features/hypothesis-engine'
import { generateAndPersistHypothesis } from '@/lib/hypothesis/generate-and-persist'
import { NextResponse, after } from 'next/server'

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

  // Fire-and-forget hypothesis generation. Runs AFTER the response so the
  // user gets the conversation id immediately; the working hypothesis lands
  // in the DB while they're navigating to the chat. If it doesn't make it
  // in time, the v2_hypothesis prompt path gracefully falls back to the
  // baseline v2 layout.
  if (shouldGenerateHypothesisOnUpload()) {
    after(async () => {
      await generateAndPersistHypothesis(supabase, user.id, 'csv_upload')
    })
  }

  return NextResponse.json({ conversationId: conversation.id })
}
