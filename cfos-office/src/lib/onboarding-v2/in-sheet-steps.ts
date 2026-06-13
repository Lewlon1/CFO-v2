import type { OnboardingStep } from './types'

/**
 * Onboarding steps whose beat runs inside the chat sheet (the deterministic
 * in-sheet onboarding flow). For these, the office layout keeps the user in
 * /office with the sheet open, and ChatSheet renders the OnboardingBeatHost
 * instead of the message list. Shared by the server layout and the client
 * sheet/host so they never drift.
 */
export const IN_SHEET_BEAT_STEPS: ReadonlySet<string> = new Set<OnboardingStep>([
  // Legacy pre-value-first stamp — forward-migrated into the in-sheet upload
  // beat so mid-flow users aren't stranded (the host treats it as upload_pending).
  'essentials_done',
  'upload_pending',
  'upload_processing',
  'details_pending',
  'details_confirmed',
  // Estimates-first flow (OB-2) — every estimate beat runs in-sheet, hosted by
  // estimate-beat-host.tsx. The terminal estimate_read_pending composes and
  // hands off the estimate Read.
  'estimate_door',
  'estimate_context',
  'estimate_composite',
  'estimate_goal',
  'estimate_income',
  'estimate_sketch',
  'estimate_verdicts',
  'estimate_read_pending',
  // Statement-check mission (OB-3) — reuses the legacy upload/confirm beats,
  // hosted by onboarding-beat-host.tsx.
  'check_upload_pending',
  'check_processing',
  'check_confirm_pending',
  // Terminal-in-flight while the reality-check Read composes (host effect).
  'check_confirm_done',
])

/** Steps whose beat is hosted by the estimates-first host (estimate-beat-host),
 *  as opposed to the legacy/check host (onboarding-beat-host). ChatSheet picks
 *  the host by this family so the two flows never cross-render. */
export const ESTIMATE_BEAT_STEPS: ReadonlySet<string> = new Set<OnboardingStep>([
  'estimate_door',
  'estimate_context',
  'estimate_composite',
  'estimate_goal',
  'estimate_income',
  'estimate_sketch',
  'estimate_verdicts',
  'estimate_read_pending',
])

/** The estimate beats in flow order. Used to pick the EARLIER of the stamped
 *  step and the data-resolved step (see the office layout): a stamped step that
 *  has run ahead of the persisted data (e.g. read_pending with a band that
 *  failed to save) must fall back to the earliest incomplete beat, not loop. */
export const ESTIMATE_STEP_ORDER: readonly OnboardingStep[] = [
  'estimate_door',
  'estimate_context',
  'estimate_composite',
  'estimate_goal',
  'estimate_income',
  'estimate_sketch',
  'estimate_verdicts',
  'estimate_read_pending',
] as const

/** Flow-order index of an estimate step, or -1 if it isn't one. */
export function estimateStepIndex(step: string | null | undefined): number {
  return ESTIMATE_STEP_ORDER.indexOf((step ?? '') as OnboardingStep)
}

export function isInSheetBeatStep(step: string | null | undefined): boolean {
  return !!step && IN_SHEET_BEAT_STEPS.has(step)
}

export function isEstimateBeatStep(step: string | null | undefined): boolean {
  return !!step && ESTIMATE_BEAT_STEPS.has(step)
}
