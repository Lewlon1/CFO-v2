import type { SupabaseClient } from '@supabase/supabase-js'
import { createNudge } from '../create'
import { shouldTriggerRetake } from '@/lib/value-map/retake-trigger'

/**
 * Evaluator for the `value_map_retake` nudge.
 *
 * Called from:
 *   - /api/cron/nudges-daily (daily sweep for all users)
 *   - /api/upload (post-import hook)
 *   - lib/ai/context-builder (monthly review system prompt — also gated by cooldown)
 *
 * The underlying shouldTriggerRetake helper applies a 14-day cooldown on both
 * retakes and nudges, so triggering from multiple entry points is safe — only
 * the first path each 14 days creates a nudge.
 */
export async function evaluateValueMapRetake(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const decision = await shouldTriggerRetake(supabase, userId)
  if (!decision.trigger) return

  await createNudge(supabase, {
    userId,
    type: 'value_map_retake',
    variables: {
      count: decision.low_confidence_count,
    },
  })
}
