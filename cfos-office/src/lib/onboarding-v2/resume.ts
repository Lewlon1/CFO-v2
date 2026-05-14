import type { OnboardingStep } from './types'

const STEP_TO_ROUTE: Record<OnboardingStep, string> = {
  // Legacy: rows still stamped 'intro_shown' from before the intro page
  // was removed should jump straight into the Value Map.
  intro_shown:       '/onboarding-v2/value-map',
  value_map_started: '/onboarding-v2/value-map',
  value_map_done:    '/onboarding-v2/upload',
  upload_done:       '/onboarding-v2/archetype',
  archetype_shown:   '/onboarding-v2/archetype',
  complete:          '/office',
}

/**
 * Resolve where the user should be in the onboarding-v2 journey.
 *
 * - No entry_struggle yet → /onboarding-v2 (struggle question)
 * - Has entry_struggle but no step → /onboarding-v2/value-map (entry into journey)
 * - Has step → mapped route
 */
export function resumeRoute(
  step: OnboardingStep | null,
  entryStruggle: string | null,
): string {
  if (!entryStruggle) return '/onboarding-v2'
  if (!step) return '/onboarding-v2/value-map'
  return STEP_TO_ROUTE[step] ?? '/onboarding-v2/value-map'
}
