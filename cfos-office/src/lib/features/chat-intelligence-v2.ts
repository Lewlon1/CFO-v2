import type { Database } from '@/lib/supabase/types'

type ProfileRow = Pick<
  Database['public']['Tables']['user_profiles']['Row'],
  'beta_cohort'
>

/**
 * Returns true when the user should be served the Session v2.2 Chat
 * Intelligence first-insight prompt + tool surface. False (default) means
 * the v1 path is used.
 *
 * Override path: set env CHAT_INTELLIGENCE_V2_FORCE=1 to enable for any user
 * regardless of cohort. Use sparingly — primarily for local dev + the
 * verify-first-insight.ts script.
 */
export function isChatIntelligenceV2Enabled(
  profile: ProfileRow | null | undefined,
): boolean {
  if (process.env.CHAT_INTELLIGENCE_V2_FORCE === '1') return true
  if (!profile) return false
  return profile.beta_cohort === 'wave_1' || profile.beta_cohort === 'wave_1_5'
}
