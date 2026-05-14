import { createClient } from '@/lib/supabase/server'
import { computeFirstInsight } from '@/lib/analytics/insight-engine'
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

  // Idempotency: if a usable first_insight conversation already exists for
  // this user, return it instead of creating a duplicate. This makes the
  // endpoint safe to call from the onboarding-v2 archetype screen even if
  // a previous upload step already created one.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'first_insight')
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    return NextResponse.json({ conversationId: existing.id, reused: true })
  }

  // Compute the full first-insight payload (pure data, no LLM)
  const payload = await computeFirstInsight(supabase, user.id)

  // Create the first_insight conversation with the payload in metadata
  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      type: 'first_insight',
      title: 'Your first look',
      metadata: {
        first_insight_payload: payload,
        import_batch_id: importBatchId,
        transaction_count: payload.transactionCount,
      },
    })
    .select('id')
    .single()

  if (error || !conversation) {
    console.error('Failed to create first-insight conversation:', error)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }

  return NextResponse.json({ conversationId: conversation.id })
}
