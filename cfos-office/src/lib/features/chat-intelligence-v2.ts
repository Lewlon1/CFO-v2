import type { Database } from '@/lib/supabase/types'

type ProfileRow = Pick<
  Database['public']['Tables']['user_profiles']['Row'],
  'beta_cohort'
>

/**
 * Returns true when the user should be served the Chat Intelligence (v2)
 * first-insight prompt + tool surface. V2 is now the default for all users.
 *
 * Escape hatch: set env CHAT_INTELLIGENCE_V2_FORCE=0 to fall back to the v1
 * deterministic-narration path. Used for local debugging and the
 * verify-first-insight.ts script when comparing V1 vs V2 side-by-side.
 *
 * The profile parameter is retained for backwards-compatible call sites but
 * is no longer consulted — beta_cohort is no-op for this gate.
 */
export function isChatIntelligenceV2Enabled(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  profile: ProfileRow | null | undefined,
): boolean {
  if (process.env.CHAT_INTELLIGENCE_V2_FORCE === '0') return false
  return true
}
