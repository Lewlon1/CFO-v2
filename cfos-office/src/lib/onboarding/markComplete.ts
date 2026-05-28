import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Permissive onboarding completion. Fire-and-forget from any write site
 * that produces a canonical engagement signal. Idempotent and one-way:
 * the UPDATE's WHERE clause guarantees a second call after the timestamp
 * is set matches zero rows.
 *
 * Eligibility (all base conditions required):
 *   - user_profiles row exists for userId
 *   - anonymised_at IS NULL
 *   - onboarding_completed_at IS NULL
 *
 * AND at least one of:
 *   - a value_map_sessions row exists for profile_id = userId, OR
 *   - the user has reached the first-read terminal state (onboarding_step
 *     in {'first_read_shown', 'archetype_shown', 'complete'}).
 *
 * Either path satisfies completion. The first Read is the default path
 * under the new flow; the Value Map is an opt-in deepening move that
 * also satisfies completion when the user takes it.
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
    .select('id, onboarding_completed_at, anonymised_at, onboarding_step')
    .eq('id', userId)
    .maybeSingle()
  if (!profile) return
  if (profile.onboarding_completed_at) return
  if (profile.anonymised_at) return

  const readReached =
    profile.onboarding_step === 'first_read_shown' ||
    profile.onboarding_step === 'archetype_shown' ||
    profile.onboarding_step === 'complete'

  let eligible = readReached
  if (!eligible) {
    const { count: vmCount } = await supabase
      .from('value_map_sessions')
      .select('id', { head: true, count: 'exact' })
      .eq('profile_id', userId)
      .limit(1)
    eligible = (vmCount ?? 0) > 0
  }
  if (!eligible) return

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
