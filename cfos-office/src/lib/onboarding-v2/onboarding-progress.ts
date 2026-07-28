/** v1 weights — pinned. Pre-upload signals sum to 60 (the ceiling on declared
 *  knowledge); the upload is the only +40 to 100, so the meter honestly reads
 *  "more to unlock" until a real month is seen. */
export const ONBOARDING_PROGRESS_WEIGHTS = {
  goal: 20,
  income: 20,
  fixedCosts: 20,
  upload: 40,
} as const

export interface OnboardingProgressSignals {
  hasGoal: boolean
  hasIncome: boolean
  hasFixedCosts: boolean
  hasUpload: boolean
}

export interface ProgressPart { label: string; earned: boolean; points: number }
export interface OnboardingProgressResult { pct: number; parts: ProgressPart[] }

/**
 * Whether the user has SUPPLIED their fixed costs, by onboarding step.
 *
 * Extracted from the layout's signal derivation because that derivation lives in
 * a server component and was untested — which is how it drifted out of step with
 * the harness's confirm-beat assertion for weeks without anyone noticing.
 *
 * - `details_pending`  — essentials saved, reconciliation on screen: KNOWN. This is
 *   the confirm beat, and the user has already typed the numbers.
 * - `details_confirmed` — they accepted the reconciliation: KNOWN.
 * - `upload_processing` — costs are being DETECTED, not declared: not yet known.
 * - anything earlier (incl. mid-typing in the essentials beat): not yet known.
 *   Keying this off `monthly_rent` lit the chip a beat early — don't.
 */
export function fixedCostsKnownAtStep(step: string | null | undefined): boolean {
  return step === 'details_pending' || step === 'details_confirmed'
}

export function onboardingProgress(s: OnboardingProgressSignals): OnboardingProgressResult {
  const w = ONBOARDING_PROGRESS_WEIGHTS
  const parts: ProgressPart[] = [
    { label: 'Goal', earned: s.hasGoal, points: w.goal },
    { label: 'Income', earned: s.hasIncome, points: w.income },
    { label: 'Fixed costs', earned: s.hasFixedCosts, points: w.fixedCosts },
    { label: 'A real month', earned: s.hasUpload, points: w.upload },
  ]
  const pct = parts.reduce((sum, p) => sum + (p.earned ? p.points : 0), 0)
  return { pct, parts }
}
