import { createClient } from '@/lib/supabase/server'
import { analyseGap } from '@/lib/analytics/gap-analyser'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const gap = await analyseGap(supabase, user.id)

  // Find the most recent post_upload conversation to continue it
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'post_upload')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (existing) {
    // Update its metadata with fresh gap analysis so the CFO has current data
    await supabase
      .from('conversations')
      .update({ metadata: { ...existing, gap_analysis: gap, value_map_just_completed: true } })
      .eq('id', existing.id)

    return Response.json({ conversationId: existing.id })
  }

  // No prior post_upload conversation — create a value_map_complete conversation
  const { data: conv, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      title: 'Value Map complete',
      type: 'value_map_complete',
      metadata: { gap_analysis: gap },
    })
    .select('id')
    .single()

  if (error || !conv) return new Response('Failed to create conversation', { status: 500 })

  return Response.json({ conversationId: conv.id })
}
