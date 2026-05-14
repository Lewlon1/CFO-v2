import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Permissive onboarding completion. Fire-and-forget from any write site
 * that produces a real engagement signal (Value Map, transactions, 3rd+
 * user message). Idempotent and one-way: the UPDATE's WHERE clause
 * guarantees a second call after the timestamp is set matches zero rows.
 *
 * Eligibility (all required):
 *   - user_profiles row exists for userId
 *   - anonymised_at IS NULL
 *   - onboarding_completed_at IS NULL
 *   - at least one of:
 *       (a) value_map_sessions row exists for profile_id = userId
 *       (b) one or more non-deleted transactions
 *       (c) three or more non-deleted role='user' messages
 *           via conversations.user_id
 *
 * Does NOT seed financial_portrait. Portrait traits are written by the
 * route-based onboarding-v2 archetype endpoint and by the post-conversation
 * extraction pipeline (see lib/ai/portrait-extraction.ts).
 */
export async function markOnboardingCompleteIfReady(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, onboarding_completed_at, anonymised_at')
    .eq('id', userId)
    .maybeSingle()
  if (!profile) return
  if (profile.onboarding_completed_at) return
  if (profile.anonymised_at) return

  const [vmResult, txResult, msgResult] = await Promise.all([
    supabase
      .from('value_map_sessions')
      .select('id', { head: true, count: 'exact' })
      .eq('profile_id', userId)
      .limit(1),
    supabase
      .from('transactions')
      .select('id', { head: true, count: 'exact' })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .limit(1),
    supabase
      .from('messages')
      .select('id, conversations!inner(user_id)')
      .eq('role', 'user')
      .is('deleted_at', null)
      .eq('conversations.user_id', userId)
      .limit(3),
  ])

  const qualifies =
    (vmResult.count ?? 0) > 0 ||
    (txResult.count ?? 0) > 0 ||
    (msgResult.data?.length ?? 0) >= 3
  if (!qualifies) return

  const { error } = await supabase
    .from('user_profiles')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', userId)
    .is('onboarding_completed_at', null)
    .is('anonymised_at', null)
  if (error) {
    console.error('[onboarding] markOnboardingCompleteIfReady update failed:', error)
  }
}
