import { describe, it, expect } from 'vitest'
import {
  onboardingProgress,
  fixedCostsKnownAtStep,
  ONBOARDING_PROGRESS_WEIGHTS,
} from './onboarding-progress'

describe('fixedCostsKnownAtStep', () => {
  it('is KNOWN at the confirm beat, before the user accepts the reconciliation', () => {
    // Regression: this returned false at details_pending, so the meter read 40%
    // at the confirm beat when the user had already given goal + income + costs.
    // The harness asserts 60% here and had been failing since 2026-06-14.
    expect(fixedCostsKnownAtStep('details_pending')).toBe(true)
  })

  it('stays known once confirmed', () => {
    expect(fixedCostsKnownAtStep('details_confirmed')).toBe(true)
  })

  it('is NOT known while an upload is being processed — those costs are detected, not declared', () => {
    expect(fixedCostsKnownAtStep('upload_processing')).toBe(false)
  })

  it('is NOT known at earlier beats, so the chip cannot light mid-typing', () => {
    for (const step of ['upload_pending', 'essentials_done', 'goal_chat_started', null, undefined]) {
      expect(fixedCostsKnownAtStep(step)).toBe(false)
    }
  })

  it('drives the pre-upload ceiling: goal + income + confirm-beat costs = 60', () => {
    const r = onboardingProgress({
      hasGoal: true,
      hasIncome: true,
      hasFixedCosts: fixedCostsKnownAtStep('details_pending'),
      hasUpload: false,
    })
    expect(r.pct).toBe(60)
  })
})

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
