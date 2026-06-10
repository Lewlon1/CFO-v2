import type { OnboardingStep } from './types'

/**
 * Resolve where the user should be in the onboarding-v2 journey.
 *
 * Value-first sequence (this branch):
 *   struggle → goal_chat → upload_processing → details_confirmed →
 *   first_read_delivered → (optional) value_map_offered → complete
 *
 * - No entry_struggle yet → /onboarding-v2 (struggle question)
 * - Mid-goal-beat (`goal_chat_started`) → /office (chat sheet hosts the
 *   onboarding_goal_chat conversation; the GoalBeatWatcher in the office
 *   layout opens it and routes onward when the goal lands). The value-first
 *   goal beat is goal-only — income / rent are collected on the processing
 *   screen, not in chat.
 * - `upload_processing` → /onboarding-v2/processing — form-during-wait.
 * - `details_confirmed` → /onboarding-v2/first-read — Read composes here.
 * - `first_read_delivered` → /onboarding-v2/first-read (terminal; stamps
 *   onboarding_completed_at). The Value Map is no longer a gate — it
 *   surfaces as an opt-in chip on the first-read page.
 * - `value_map_offered` → /onboarding-v2/value-map (real-transactions mode).
 * - `essentials_done` (legacy) → /onboarding-v2/upload. The processing
 *   screen prefills income / rent from user_profiles and auto-skips the
 *   form so legacy users aren't asked twice.
 * - Goal set/skipped (legacy, pre-essentials_done) → /onboarding-v2/value-map.
 *   Users mid-flow before this change get the old behavior so nobody is
 *   stranded.
 * - Mid-value-map journey (value_map / upload / first-read) → mapped route.
 *   Session 32 (B) added the `/onboarding-v2/first-read` route; users stamped
 *   `archetype_shown` mid-flow on the old surface still route to archetype.
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
    case 'goal_chat_tentative':
      // Goal beat lives inside the office chat sheet — tentative is the
      // post-stall pivot to essentials, same surface.
      return '/office'
    case 'essentials_done':
    case 'upload_pending':
    case 'upload_processing':
    case 'details_pending':
    case 'details_confirmed':
      // Value-first — the upload → essentials → confirm → Read hand-off now
      // all runs inside the chat sheet (OnboardingBeatHost). Keep the user in
      // /office; the host renders the beat for the current step. (The legacy
      // 'essentials_done' stamp forward-migrates into the in-sheet upload beat.)
      return '/office'
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
      return '/onboarding-v2/first-read'
    case 'archetype_shown':
      // A user stamped 'archetype_shown' was in the pre-layered flow at the
      // time of stamping. Route them back to the archetype page — they're
      // mid-flow on the old surface.
      return '/onboarding-v2/archetype'
    case 'first_read_shown':
      // Session 32 (B) — layered terminal state. Route back if mid-flow.
      return '/onboarding-v2/first-read'
    case 'first_read_delivered':
      // Value-first terminal — Read composed, delivered into the chat sheet,
      // and onboarding stamped complete. The Value Map invite is inline in the
      // Read message. Land in /office.
      return '/office'
    case 'value_map_offered':
      // User has tapped the post-Read Value Map invite (real-transactions
      // mode). Send them to the Value Map page.
      return '/onboarding-v2/value-map'
    case 'complete':
      return '/office'
    default:
      return isMarcus ? '/onboarding-v2/value-map' : '/office'
  }
}
