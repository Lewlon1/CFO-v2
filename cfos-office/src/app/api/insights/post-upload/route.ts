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

  const { importBatchId } = await req.json()

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
        import_batch_id: importBatchId ?? null,
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
