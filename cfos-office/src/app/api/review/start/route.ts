import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { extractFromConversation } from '@/lib/ai/portrait-extraction'
import { extractProfileFields } from '@/lib/ai/profile-extraction'
import { sendAlert } from '@/lib/alerts/notify'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  let month: string | null = body.month ?? null // YYYY-MM

  // If no month specified, find the most recent unreviewed month
  if (!month) {
    const { data: unreviewed } = await supabase
      .from('monthly_snapshots')
      .select('month')
      .eq('user_id', user.id)
      .is('reviewed_at', null)
      .order('month', { ascending: false })
      .limit(1)
      .single()

    if (!unreviewed) {
      return NextResponse.json({ error: 'No unreviewed months available' }, { status: 404 })
    }
    // month column is stored as 'YYYY-MM-01', extract YYYY-MM
    month = unreviewed.month.slice(0, 7)
  }

  const monthDate = `${month}-01`

  // Check the snapshot exists
  const { data: snapshot } = await supabase
    .from('monthly_snapshots')
    .select('id, review_conversation_id')
    .eq('user_id', user.id)
    .eq('month', monthDate)
    .single()

  if (!snapshot) {
    return NextResponse.json({ error: 'No snapshot for this month' }, { status: 404 })
  }

  // Idempotent: if a review conversation already exists, return it
  if (snapshot.review_conversation_id) {
    return NextResponse.json({
      conversationId: snapshot.review_conversation_id,
      reviewMonth: month,
    })
  }

  // Mark existing active conversations as completed
  const { data: completedConvs } = await supabase
    .from('conversations')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('status', 'active')
    .select('id')

  // Post-conversation portrait extraction for any conversations we just
  // marked completed. Wrapped in `after()` so the work survives past the
  // response (a bare `fetch().catch()` here was killed by Vercel before
  // landing — see S-W1.5-11). On failure, `analysed_at` stays NULL and the
  // daily cron at /api/cron/portrait-extraction picks it up.
  if (completedConvs && completedConvs.length > 0) {
    for (const conv of completedConvs) {
      after(async () => {
        try {
          const serviceSupabase = createServiceClient()
          await extractFromConversation(serviceSupabase, {
            conversationId: conv.id,
            userId: user.id,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error('[review/start] post-conversation extraction failed:', message)
          await sendAlert({
            severity: 'critical',
            event: 'portrait_extraction_after_failed',
            user_id: user.id,
            details: message,
            metadata: { conversationId: conv.id, callSite: 'review_start_route' },
          }).catch(() => {})
        }
      })

      after(async () => {
        try {
          const serviceSupabase = createServiceClient()
          await extractProfileFields(serviceSupabase, {
            conversationId: conv.id,
            userId: user.id,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error('[review/start] post-conversation profile extraction failed:', message)
          await sendAlert({
            severity: 'critical',
            event: 'profile_extraction_after_failed',
            user_id: user.id,
            details: message,
            metadata: { conversationId: conv.id, callSite: 'review_start_route' },
          }).catch(() => {})
        }
      })
    }

    // Stamp reviewed_at on any completed monthly reviews
    const completedIds = completedConvs.map(c => c.id)
    await supabase
      .from('monthly_snapshots')
      .update({ reviewed_at: new Date().toISOString() })
      .in('review_conversation_id', completedIds)
      .is('reviewed_at', null)
  }

  // Create the review conversation
  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      title: `Monthly Review — ${month}`,
      type: 'monthly_review',
      status: 'active',
      metadata: { review_month: month },
    })
    .select('id')
    .single()

  if (error || !conversation) {
    console.error('[review/start] conversation insert failed:', error)
    return NextResponse.json({ error: 'Failed to create review conversation' }, { status: 500 })
  }

  // Link the snapshot to this conversation
  await supabase
    .from('monthly_snapshots')
    .update({ review_conversation_id: conversation.id })
    .eq('id', snapshot.id)

  return NextResponse.json({
    conversationId: conversation.id,
    reviewMonth: month,
  })
}
