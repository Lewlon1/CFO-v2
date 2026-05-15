import type { OnboardingStep } from './types'

/**
 * Resolve where the user should be in the onboarding-v2 journey.
 *
 * - No entry_struggle yet → /onboarding-v2 (struggle question)
 * - Mid-goal-beat (`goal_chat_started`) → /office (chat sheet hosts the
 *   onboarding_goal_chat conversation; the GoalBeatWatcher in the office
 *   layout opens it and watches for completion).
 * - Goal set or skipped → /onboarding-v2/value-map for both routes. The
 *   Value Map is mandatory for onboarding completion regardless of entry
 *   struggle (Marcus is force-redirected; chat-path users carry themselves
 *   in via the in-chat <ACTION:start_value_map> CTA or the office banner).
 * - Mid-value-map journey (value_map / upload / archetype) → mapped route.
 * - Complete → /office.
 */
export function resumeRoute(
  step: OnboardingStep | null,
  entryStruggle: string | null,
): string {
  if (!entryStruggle) return '/onboarding-v2'

  const isMarcus = entryStruggle === 'dont_know'

  switch (step) {
    case null:
      // Legacy: row exists but step never stamped. Treat as start of journey.
      return isMarcus ? '/onboarding-v2/value-map' : '/office'
    case 'intro_shown':
      // Legacy: rows stamped 'intro_shown' before the intro page was removed.
      return isMarcus ? '/onboarding-v2/value-map' : '/office'
    case 'goal_chat_started':
      // Goal beat lives inside the office chat sheet.
      return '/office'
    case 'goal_set':
    case 'goal_skipped':
      // Value Map is mandatory for both routes.
      return '/onboarding-v2/value-map'
    case 'value_map_started':
      return '/onboarding-v2/value-map'
    case 'value_map_done':
      return '/onboarding-v2/upload'
    case 'upload_done':
      return '/onboarding-v2/archetype'
    case 'archetype_shown':
      return '/onboarding-v2/archetype'
    case 'complete':
      return '/office'
    default:
      return isMarcus ? '/onboarding-v2/value-map' : '/office'
  }
}
