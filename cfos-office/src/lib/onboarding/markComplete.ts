import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Permissive onboarding completion. Fire-and-forget from any write site
 * that produces the canonical engagement signal (Value Map session).
 * Idempotent and one-way: the UPDATE's WHERE clause guarantees a second
 * call after the timestamp is set matches zero rows.
 *
 * Eligibility (all required):
 *   - user_profiles row exists for userId
 *   - anonymised_at IS NULL
 *   - onboarding_completed_at IS NULL
 *   - a value_map_sessions row exists for profile_id = userId
 *
 * The Value Map is the mandatory completion signal — transactions or chat
 * messages alone do not satisfy it. Both the chat-path and value-map (Marcus)
 * onboarding routes converge here.
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

  const { count: vmCount } = await supabase
    .from('value_map_sessions')
    .select('id', { head: true, count: 'exact' })
    .eq('profile_id', userId)
    .limit(1)

  if ((vmCount ?? 0) === 0) return

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
