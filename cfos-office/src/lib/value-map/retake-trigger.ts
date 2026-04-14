import type { SupabaseClient } from '@supabase/supabase-js'
import { selectRetakeCandidates } from './retake-candidates'

export type RetakeDecision =
  | {
      trigger: true
      reason: 'signal_threshold'
      low_confidence_count: number
      last_retake_at: string | null
      top_merchants: string[]
    }
  | {
      trigger: false
      reason: 'cooldown' | 'insufficient_signals' | 'recent_nudge' | 'no_activity'
    }

const RETAKE_COOLDOWN_DAYS = 14
const NUDGE_COOLDOWN_DAYS = 14
const SIGNAL_THRESHOLD = 20
const UNCERTAIN_WINDOW_DAYS = 60

/**
 * Decide whether the CFO should proactively suggest a Value Map retake.
 *
 * Rules (all must pass):
 * 1. No personal retake completed in the last 14 days.
 * 2. No `value_map_retake` nudge created in the last 14 days.
 * 3. At least 20 low-confidence merchant-rule transactions in the last 60 days.
 * 4. `selectRetakeCandidates` returns a viable retake (>= 8 qualifying merchants).
 */
export async function shouldTriggerRetake(
  supabase: SupabaseClient,
  userId: string,
): Promise<RetakeDecision> {
  const now = new Date()

  // ── 1. Last personal retake cooldown ──────────────────────────────────
  const retakeCooldownStart = new Date(now)
  retakeCooldownStart.setDate(retakeCooldownStart.getDate() - RETAKE_COOLDOWN_DAYS)

  const { data: recentRetake } = await supabase
    .from('value_map_sessions')
    .select('id, created_at')
    .eq('profile_id', userId)
    .eq('is_real_data', true)
    .gte('created_at', retakeCooldownStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recentRetake) {
    return { trigger: false, reason: 'cooldown' }
  }

  // ── 2. Last nudge cooldown ────────────────────────────────────────────
  const nudgeCooldownStart = new Date(now)
  nudgeCooldownStart.setDate(nudgeCooldownStart.getDate() - NUDGE_COOLDOWN_DAYS)

  const { count: recentNudges } = await supabase
    .from('nudges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('type', 'value_map_retake')
    .gte('created_at', nudgeCooldownStart.toISOString())

  if ((recentNudges ?? 0) > 0) {
    return { trigger: false, reason: 'recent_nudge' }
  }

  // ── 3. Signal threshold: enough uncertain spending? ───────────────────
  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() - UNCERTAIN_WINDOW_DAYS)

  const { count: lowConfidenceCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('value_confirmed_by_user', false)
    .lt('value_confidence', 0.7)
    .gte('date', windowStart.toISOString())
    .lt('amount', 0)

  if ((lowConfidenceCount ?? 0) < SIGNAL_THRESHOLD) {
    return { trigger: false, reason: 'insufficient_signals' }
  }

  // ── 4. Sanity check: can we even build a viable retake? ───────────────
  const candidates = await selectRetakeCandidates(supabase, userId)
  if (!candidates.ok) {
    return { trigger: false, reason: 'insufficient_signals' }
  }

  // Grab last non-personal session timestamp for UX context
  const { data: lastAny } = await supabase
    .from('value_map_sessions')
    .select('created_at')
    .eq('profile_id', userId)
    .eq('is_real_data', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const topMerchants = candidates.transactions
    .slice(0, 3)
    .map((t) => t.merchant)
    .filter((m): m is string => !!m)

  return {
    trigger: true,
    reason: 'signal_threshold',
    low_confidence_count: lowConfidenceCount ?? 0,
    last_retake_at: lastAny?.created_at ?? null,
    top_merchants: topMerchants,
  }
}
