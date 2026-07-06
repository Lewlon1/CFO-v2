import { describe, it, expect } from 'vitest'
import { onboardingProgress, ONBOARDING_PROGRESS_WEIGHTS } from './onboarding-progress'

describe('onboardingProgress', () => {
  it('caps the pre-upload signals below full knowledge', () => {
    const r = onboardingProgress({ hasGoal: true, hasIncome: true, hasFixedCosts: true, hasUpload: false })
    expect(r.pct).toBe(60) // 20 + 20 + 20, the pre-upload ceiling
  })
  it('upload is the only way past the ceiling', () => {
    const r = onboardingProgress({ hasGoal: true, hasIncome: true, hasFixedCosts: true, hasUpload: true })
    expect(r.pct).toBe(100)
  })
  it('weights sum to 100 at all-true', () => {
    const w = ONBOARDING_PROGRESS_WEIGHTS
    expect(w.goal + w.income + w.fixedCosts + w.upload).toBe(100)
  })
})
