import type { OnboardingStep } from './types'

const STEP_TO_ROUTE: Record<OnboardingStep, string> = {
  intro_shown:       '/onboarding-v2/intro',
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
 * - Has entry_struggle but no step → /onboarding-v2/intro (entry into journey)
 * - Has step → mapped route
 *
 * Note: chat-route users (entry_struggle != 'dont_know') only have an
 * onboarding_step set if they accepted the Value Map bridge in chat. They
 * pass through the same intro page; the intro screen selects the headline
 * via entry_struggle.
 */
export function resumeRoute(
  step: OnboardingStep | null,
  entryStruggle: string | null,
): string {
  if (!entryStruggle) return '/onboarding-v2'
  if (!step) return '/onboarding-v2/intro'
  return STEP_TO_ROUTE[step] ?? '/onboarding-v2/intro'
}
