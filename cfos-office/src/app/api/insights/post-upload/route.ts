import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
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
  //
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

  // Skip-upload path: a user who reached details_confirmed with NO imported
  // transactions gets the declared-numbers Read (income + fixed costs → free
  // cash + goal pace) instead of the transaction-based value_first Read. A
  // later statement upload is folded into the data model via the existing
  // reconcile/dedupe — it does NOT recompose this onboarding Read.
  const { count: txnCount, error: txnCountError } = await supabase
    .from('transactions')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', user.id)
  if (txnCountError) {
    // Count failed — fall back to declared mode (hasTxns stays false). declared
    // is the safe fallback: it composes from the declared numbers both user
    // types have, whereas value_first needs transactions and would render empty.
    console.error('[post-upload] transaction count failed; using declared mode', txnCountError)
  }
  const hasTxns = (txnCount ?? 0) > 0

  const mode: ComposeFirstReadMode =
    stepProfile?.onboarding_step === 'details_confirmed'
      ? (hasTxns ? 'value_first' : 'declared')
      : 'default'
  return handleLayeredFirstRead({ supabase, userId: user.id, importBatchId, mode })
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
  // Declared mode only — snapshot the facts the Read stood on, so a later
  // declared→actual upgrade can render a numeric DECLARED → ACTUAL delta
  // (the snapshot is the BEFORE side; without it the upgrade stays qualitative).
  if (composed.declaredFacts) {
    conversationMetadata.declared_facts = composed.declaredFacts
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
