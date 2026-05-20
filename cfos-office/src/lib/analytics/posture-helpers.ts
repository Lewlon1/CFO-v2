/**
 * Posture transform helpers — the single gate that decides whether
 * any UI / voice / context / prompt code applies a posture-specific variant.
 *
 * Stable and unknown postures always return null. Surviving and planning
 * return the posture only when confidence clears the threshold.
 *
 * Centralised so the threshold can be tuned in one place without hunting
 * across the codebase.
 */

import type { FinancialPosture } from './posture'

// ─── TUNABLE_CONSTANTS ───────────────────────────────────────────────────
// Revisit empirically after Wave 1 users hit posture detection at scale.

const MIN_CONFIDENCE_FOR_TRANSFORM = 0.80

// ─── Types ───────────────────────────────────────────────────────────────

export type TransformPosture = 'surviving' | 'planning'

export interface PostureProfile {
  financial_posture: FinancialPosture | null
  posture_confidence: number | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the posture to render variants for, or null if the user should
 * see the default (unchanged) experience.
 *
 * Returns null when:
 *   - profile is null/undefined
 *   - posture is null / unknown / stable
 *   - confidence is null or below MIN_CONFIDENCE_FOR_TRANSFORM
 */
export function getTransformPosture(
  profile: PostureProfile | null | undefined,
): TransformPosture | null {
  if (!profile) return null
  if (!profile.financial_posture) return null
  if (profile.financial_posture !== 'surviving' && profile.financial_posture !== 'planning') {
    return null
  }
  if (profile.posture_confidence === null || profile.posture_confidence === undefined) {
    return null
  }
  if (profile.posture_confidence < MIN_CONFIDENCE_FOR_TRANSFORM) {
    return null
  }
  return profile.financial_posture
}
