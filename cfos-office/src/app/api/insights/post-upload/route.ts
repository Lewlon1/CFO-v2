import { createClient } from '@/lib/supabase/server'
import { analyseGap } from '@/lib/analytics/gap-analyser'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { importBatchId, transactionCount } = await req.json()

  // Run gap analysis (pure data comparison, no LLM)
  const gapResult = await analyseGap(supabase, user.id)

  // Create the post_upload conversation with metadata
  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      type: 'post_upload',
      title: 'Your first look',
      metadata: {
        gap_analysis: gapResult,
        import_batch_id: importBatchId ?? null,
        transaction_count: transactionCount ?? 0,
      },
    })
    .select('id')
    .single()

  if (error || !conversation) {
    console.error('Failed to create post-upload conversation:', error)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }

  return NextResponse.json({ conversationId: conversation.id })
}
