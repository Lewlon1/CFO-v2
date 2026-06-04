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
])

export function isInSheetBeatStep(step: string | null | undefined): boolean {
  return !!step && IN_SHEET_BEAT_STEPS.has(step)
}
