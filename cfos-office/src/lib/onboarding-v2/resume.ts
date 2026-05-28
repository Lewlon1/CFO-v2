import type { OnboardingStep } from './types'
import { isLayeredReadEnabled } from '@/lib/feature-flags/layered-read'

/**
 * Resolve where the user should be in the onboarding-v2 journey.
 *
 * - No entry_struggle yet → /onboarding-v2 (struggle question)
 * - Mid-goal-beat (`goal_chat_started`) → /office (chat sheet hosts the
 *   onboarding_goal_chat conversation; the GoalBeatWatcher in the office
 *   layout opens it and watches for completion).
 * - Essentials done (goal + income + rent collected inline in goal-chat)
 *   → /onboarding-v2/upload. The Value Map is no longer an onboarding
 *   gate — it surfaces as an opt-in chip on the first-read page.
 * - Goal set/skipped (legacy, pre-essentials_done) → /onboarding-v2/value-map.
 *   Users mid-flow before this change get the old behavior so nobody is
 *   stranded.
 * - Mid-value-map journey (value_map / upload / archetype-or-first-read) →
 *   mapped route. Session 32 (B) added the parallel `/onboarding-v2/first-read`
 *   route for layered-read users; the routing fork is gated by
 *   isLayeredReadEnabled().
 * - Complete → /office.
 */
export function resumeRoute(
  step: OnboardingStep | null,
  entryStruggle: string | null,
): string {
  if (!entryStruggle) return '/onboarding-v2'

  const isMarcus = entryStruggle === 'dont_know'
  const layered = isLayeredReadEnabled()
  const postUploadRoute = layered ? '/onboarding-v2/first-read' : '/onboarding-v2/archetype'

  switch (step) {
    case null:
      // Legacy: row exists but step never stamped. Treat as start of journey.
      return isMarcus ? '/onboarding-v2/value-map' : '/office'
    case 'intro_shown':
      // Legacy: rows stamped 'intro_shown' before the intro page was removed.
      return isMarcus ? '/onboarding-v2/value-map' : '/office'
    case 'goal_chat_started':
    case 'goal_chat_tentative':
      // Goal beat lives inside the office chat sheet — tentative is the
      // post-stall pivot to essentials, same surface.
      return '/office'
    case 'essentials_done':
      // New flow — goal + essentials collected in goal-chat, head to upload.
      return '/onboarding-v2/upload'
    case 'goal_set':
    case 'goal_skipped':
      // Legacy path — users stamped before essentials_done landed continue
      // to the Value Map as before.
      return '/onboarding-v2/value-map'
    case 'value_map_started':
      return '/onboarding-v2/value-map'
    case 'value_map_done':
      return '/onboarding-v2/upload'
    case 'upload_done':
      return postUploadRoute
    case 'archetype_shown':
      // A user stamped 'archetype_shown' was in the non-layered flow at the
      // time of stamping. Route them back to the archetype page even if the
      // flag is now on — they're mid-flow on the old surface.
      return '/onboarding-v2/archetype'
    case 'first_read_shown':
      // Session 32 (B) — layered terminal state. Route back if mid-flow.
      return '/onboarding-v2/first-read'
    case 'complete':
      return '/office'
    default:
      return isMarcus ? '/onboarding-v2/value-map' : '/office'
  }
}
