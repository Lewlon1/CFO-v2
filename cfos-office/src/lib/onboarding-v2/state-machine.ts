import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Canonical state machine for onboarding-v2.
 *
 * All transitions go through `transitionStep`. All routing goes through
 * `resumeRoute`. There is exactly one place this state lives.
 */

export const ONBOARDING_STEPS = [
  'goal_chat_started',
  'goal_chat_tentative',
  'goal_set',
  'goal_skipped',
  'value_map_started',
  'value_map_done',
  'upload_done',
  'archetype_shown',
  'complete',
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/**
 * Legacy values that may exist in old rows. The state machine never writes
 * these. The resume resolver treats them as start-of-journey.
 */
export const LEGACY_STEPS = ['intro_shown'] as const
export type LegacyStep = (typeof LEGACY_STEPS)[number]

/**
 * Legal transitions. A transition is legal iff `to` is in `STEP_TRANSITIONS[from]`.
 * `null` represents "no step yet" — the user has only just submitted the struggle.
 */
export const STEP_TRANSITIONS: Record<OnboardingStep | 'null', readonly OnboardingStep[]> = {
  null: ['goal_chat_started'],
  goal_chat_started: ['goal_chat_tentative', 'goal_set', 'goal_skipped'],
  goal_chat_tentative: ['goal_set', 'goal_skipped', 'value_map_started'],
  goal_set: ['value_map_started'],
  goal_skipped: ['value_map_started'],
  value_map_started: ['value_map_done', 'goal_set'],
  value_map_done: ['upload_done', 'complete'],
  upload_done: ['archetype_shown'],
  archetype_shown: ['complete'],
  complete: [],
}

export class IllegalTransitionError extends Error {
  constructor(
    public from: OnboardingStep | null,
    public to: OnboardingStep,
  ) {
    super(`Illegal onboarding transition: ${from ?? 'null'} → ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

/**
 * Validate a transition. Returns the new step if legal, throws otherwise.
 * Callers should still write to the DB themselves — this is the gate,
 * not the persistence layer.
 */
export function transitionStep(
  from: OnboardingStep | null,
  to: OnboardingStep,
): OnboardingStep {
  const fromKey = (from ?? 'null') as OnboardingStep | 'null'
  const allowed = STEP_TRANSITIONS[fromKey]
  if (!allowed || !allowed.includes(to)) {
    throw new IllegalTransitionError(from, to)
  }
  return to
}

/**
 * The single resume resolver. Used by every page that needs to figure out
 * where a mid-onboarding user should land, including the office layout.
 *
 * Behaviour-preservation: the mapping below must match exactly what
 * the old `resume.ts` returned for every (step, struggle) pair seen in
 * staging. Any change in behaviour means the refactor was wrong.
 */
export function resumeRoute(
  step: OnboardingStep | LegacyStep | null,
  entryStruggle: string | null,
): string {
  if (!entryStruggle) return '/onboarding-v2'

  const isMarcus = entryStruggle === 'dont_know'

  if (step === null || step === 'intro_shown') {
    return isMarcus ? '/onboarding-v2/value-map' : '/office'
  }

  switch (step) {
    case 'goal_chat_started':
    case 'goal_chat_tentative':
      return '/office'
    case 'goal_set':
    case 'goal_skipped':
    case 'value_map_started':
      return '/onboarding-v2/value-map'
    case 'value_map_done':
      return isMarcus ? '/onboarding-v2/upload' : '/office'
    case 'upload_done':
    case 'archetype_shown':
      return '/onboarding-v2/archetype'
    case 'complete':
      return '/office'
    default: {
      const _exhaustive: never = step
      void _exhaustive
      return isMarcus ? '/onboarding-v2/value-map' : '/office'
    }
  }
}

/**
 * Centralised set check. The office layout previously hardcoded this as
 * MID_MARCUS_STEPS — extracted here so the rules can't drift.
 */
export function isMidMarcusJourney(step: OnboardingStep | null): boolean {
  if (!step) return false
  return (
    step === 'goal_set' ||
    step === 'goal_skipped' ||
    step === 'value_map_started' ||
    step === 'value_map_done' ||
    step === 'upload_done' ||
    step === 'archetype_shown'
  )
}

/**
 * Validate-and-persist helper. Most call sites just want "advance to X" —
 * this reads the current step, calls transitionStep, and writes the new step
 * in one shot. The caller still owns any additional fields it needs to write
 * (those should stay in their existing UPDATE statements; this helper is for
 * the single-field common case).
 *
 * Throws IllegalTransitionError if the transition is not legal. Callers
 * typically want to let that throw — illegal transitions are bugs, not events.
 */
export async function transitionAndPersist(
  supabase: SupabaseClient,
  userId: string,
  to: OnboardingStep,
): Promise<{ from: OnboardingStep | null; to: OnboardingStep }> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('onboarding_step')
    .eq('id', userId)
    .single()

  const from = (profile?.onboarding_step ?? null) as OnboardingStep | null
  const next = transitionStep(from, to)

  const { error } = await supabase
    .from('user_profiles')
    .update({ onboarding_step: next })
    .eq('id', userId)

  if (error) {
    throw new Error(
      `transitionAndPersist update failed (${from ?? 'null'} → ${to}): ${error.message}`,
    )
  }

  return { from, to: next }
}
