import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { composeFirstRead } from '@/lib/ai/compose-first-read'
import { NextResponse } from 'next/server'

/**
 * Value-first onboarding — after the user completes the optional Value Map
 * on the real flagged transactions named by the First Read's HOOK, Layer 2
 * (Stated Intent) is now populated. We recompose the Read with mode
 * 'value_first' and insert it as a FOLLOW-UP assistant message into the
 * same first_insight conversation, so the thread reads:
 *
 *   original Read (hook close)  →  user's Value Map  →  deepened follow-up
 *
 * Same conversation, not a new one — the value-first flow is one continuous
 * narrative, deepened by the user's input. composeFirstRead automatically
 * picks up the new Layer 2 via buildUserValueProfile, so no further wiring
 * is required.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find the active layered first_insight conversation. (post-upload marked
  // anything stale as completed before composing, so the active one is the
  // most recent.)
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, metadata')
    .eq('user_id', user.id)
    .eq('type', 'first_insight')
    .eq('metadata->>layered_read', 'true')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conversation) {
    return NextResponse.json(
      { error: 'No first_insight conversation to recompose into' },
      { status: 404 },
    )
  }

  const svc = createServiceClient()
  let composed: Awaited<ReturnType<typeof composeFirstRead>>
  try {
    composed = await composeFirstRead({
      userId: user.id,
      supabase: svc,
      mode: 'value_first',
    })
  } catch (err) {
    console.error('[recompose-first-read] composeFirstRead failed:', err)
    return NextResponse.json({ error: 'Failed to recompose' }, { status: 500 })
  }

  // Append the follow-up message. Use the service client because messages
  // RLS may not accept inserts with role='assistant' from the user session.
  const { error: msgError } = await svc.from('messages').insert({
    conversation_id: conversation.id,
    user_id: user.id,
    role: 'assistant',
    content: composed.composedMessage,
  })

  if (msgError) {
    console.error('[recompose-first-read] message insert failed:', msgError)
    return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 })
  }

  // Refresh the conversation's metadata snapshot so dashboards/cron see the
  // post-Value-Map composition state.
  const prevMeta = (conversation.metadata as Record<string, unknown> | null) ?? {}
  const newMeta = {
    ...prevMeta,
    first_read_metadata_recomposed: composed.metadata,
  }
  await supabase
    .from('conversations')
    .update({ metadata: newMeta, updated_at: new Date().toISOString() })
    .eq('id', conversation.id)

  return NextResponse.json({
    conversationId: conversation.id,
    message_persisted: true,
    layers_used: composed.metadata.layers_used,
  })
}
