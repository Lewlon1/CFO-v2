import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { composeEstimateRead } from '@/lib/ai/compose-estimate-read'
import { NextResponse } from 'next/server'

/**
 * Estimate Read delivery (OB-2). Mirrors /api/insights/post-upload: composes the
 * Read as a pre-written assistant message so ChatProvider's auto-trigger (gated
 * on msgs.length === 0) does NOT fire, persists composition metadata on the
 * conversation, and returns the conversationId for the beat host to load.
 *
 * The conversation keeps type='first_read' (preserving instrumentation and the
 * recompose lookup) and is tagged metadata.estimate_read = true so OB-3's
 * reality-check can append to this same thread. Idempotent — a retry reuses the
 * existing estimate-read conversation.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = user.id

  // Idempotency: reuse an existing estimate-read conversation if one exists.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'first_read')
    .eq('metadata->>estimate_read', 'true')
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    return NextResponse.json({ conversationId: existing.id, reused: true })
  }

  // Mark any stale typed first_read conversations completed so the user's list
  // isn't cluttered when the new estimate-read conversation appears.
  await supabase
    .from('conversations')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('type', 'first_read')
    .neq('status', 'completed')

  const svc = createServiceClient()

  let composed: Awaited<ReturnType<typeof composeEstimateRead>>
  try {
    composed = await composeEstimateRead({ userId, supabase: svc })
  } catch (err) {
    console.error('[estimate-read] composeEstimateRead failed:', err)
    return NextResponse.json({ error: 'Failed to compose estimate read' }, { status: 500 })
  }

  const conversationMetadata: Record<string, unknown> = {
    estimate_read: true,
    layered_read: true,
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
    console.error('[estimate-read] conversation insert failed:', convError)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }

  // Pre-write the composed message with the service client (the messages RLS
  // policy may not let the user's session insert role='assistant').
  const { error: msgError } = await svc.from('messages').insert({
    conversation_id: conversation.id,
    user_id: userId,
    role: 'assistant',
    content: composed.composedMessage,
  })

  if (msgError) {
    console.error('[estimate-read] message insert failed:', msgError)
    // Soft-fail: return the conversation; ChatProvider falls through to its
    // default trigger.
    return NextResponse.json({ conversationId: conversation.id, message_persisted: false })
  }

  return NextResponse.json({ conversationId: conversation.id, message_persisted: true })
}
