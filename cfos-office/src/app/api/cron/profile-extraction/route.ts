import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { extractProfileFields } from '@/lib/ai/profile-extraction'
import { sendAlert } from '@/lib/alerts/notify'

export const maxDuration = 60

const LOOKBACK_DAYS = 7
const BATCH_LIMIT = 50

// Daily fallback for the post-conversation profile-field extractor.
//
// Picks up any completed conversations from the last 7 days that haven't
// been processed (`profile_extracted_at IS NULL`). Mirrors the portrait
// extractor cron so transient Bedrock or DB failures during the primary
// `after()` path don't permanently lose data.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString()

  const { data: pending, error: queryError } = await supabase
    .from('conversations')
    .select('id, user_id')
    .eq('status', 'completed')
    .is('profile_extracted_at', null)
    .is('deleted_at', null)
    .gt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (queryError) {
    console.error('[cron/profile-extraction] query failed:', queryError.message)
    return NextResponse.json({ error: 'query_failed', detail: queryError.message }, { status: 500 })
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ processed: 0, succeeded: 0, skipped: 0, failed: 0 })
  }

  const results = await Promise.allSettled(
    pending.map((conv) =>
      extractProfileFields(supabase, { conversationId: conv.id, userId: conv.user_id }),
    ),
  )

  let succeeded = 0
  let skipped = 0
  const failures: { conversationId: string; userId: string; error: string }[] = []

  results.forEach((result, idx) => {
    const conv = pending[idx]
    if (result.status === 'fulfilled') {
      if (result.value.status === 'skipped') skipped++
      else succeeded++
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      failures.push({ conversationId: conv.id, userId: conv.user_id, error: message })
    }
  })

  if (failures.length > 0) {
    console.error('[cron/profile-extraction] failures:', JSON.stringify(failures))
    void sendAlert({
      severity: 'critical',
      event: 'profile_extraction_cron_failures',
      details: `${failures.length} of ${pending.length} extractions failed in the daily sweep.`,
      metadata: { failures: failures.slice(0, 10), total: failures.length },
    })
  }

  return NextResponse.json({
    processed: pending.length,
    succeeded,
    skipped,
    failed: failures.length,
    timestamp: new Date().toISOString(),
  })
}
