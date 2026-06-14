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
