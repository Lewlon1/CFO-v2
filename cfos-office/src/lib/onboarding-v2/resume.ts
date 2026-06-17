import type { OnboardingStep } from './types'

/**
 * Resolve where the user should be in the onboarding journey, for the
 * `/onboarding-v2/*` redirect pages and mid-flow refreshes.
 *
 * Estimates-first sequence (OB-2 — the current flow):
 *   door → context → composite → goal → income → sketch → verdicts →
 *   read (estimate_read_pending) → first_read_delivered (completion) →
 *   (optional) statement-check mission → (optional) value map → complete
 *
 * Every estimate_* and check_* beat runs in-sheet at /office (the office
 * layout picks the beat from onboarding_step / the estimate resume resolver),
 * so they all resolve to /office. Brand-new users and legacy pre-estimate
 * stamps (intro_shown, goal_chat_*, goal_set/skipped, essentials_done,
 * upload_pending) also resolve to /office, where they forward into the
 * estimate flow.
 *
 * IMPORTANT: the old "Marcus" bifurcation (entry_struggle === 'dont_know' →
 * value-map) is GONE for these states. 'dont_know' is now the candor door
 * family's entry_struggle, so a brand-new candor user carries it — routing
 * them to the legacy value-map would strand them. The genuine mid-value-map
 * legacy states (value_map_started / value_map_offered) still route to the
 * value-map page; those are only reached by the opt-in Value Map, never by a
 * new user's door classification.
 *
 * Legacy states kept on their original surfaces:
 * - `upload_processing` / `details_pending` / `details_confirmed` → /office
 *   (these users have transactions mid-pipeline; they stay on the legacy
 *   value-first beats, not the estimate beats).
 * - `value_map_*`, `upload_done`, `archetype_shown`, `first_read_shown` →
 *   their original onboarding-v2 routes.
 */
export function resumeRoute(
  step: OnboardingStep | null,
  _entryStruggle: string | null,
): string {
  switch (step) {
    // Genuine mid-value-map legacy states (Marcus-era + the opt-in Value Map).
    case 'value_map_started':
    case 'value_map_offered':
      return '/onboarding-v2/value-map'
    case 'value_map_done':
      return '/onboarding-v2/upload'
    case 'upload_done':
    case 'first_read_shown':
      // Session 32 (B) layered terminal states — route back if mid-flow.
      return '/onboarding-v2/first-read'
    case 'archetype_shown':
      // Mid-flow on the old (pre-layered) surface.
      return '/onboarding-v2/archetype'

    // Everything else lands in /office:
    // - estimate_* / check_* beats (hosted in-sheet),
    // - reality_check_delivered + first_read_delivered (completion terminals),
    // - legacy pre-estimate stamps (forward-routed into the estimate flow),
    // - legacy value-first in-sheet beats (upload_processing → details_confirmed),
    // - complete.
    default:
      return '/office'
  }
}
