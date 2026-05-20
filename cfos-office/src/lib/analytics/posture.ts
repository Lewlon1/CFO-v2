/**
 * Posture Detector
 *
 * Pure function: given shape and cash-flow aggregates, returns the user's
 * posture (surviving / stable / planning / unknown) plus a confidence
 * score. No LLM, no DB. The system computes; the LLM never derives.
 *
 * Runway is the primary signal because it means the same thing across
 * every persona: how long can you pay yourself at current spend without
 * new income. Income level, savings rate, even net worth — all of them
 * distort. Runway is the cleanest universal posture signal.
 */

import type { IncomeShape } from './income-shape'
import type { CashFlowAggregates } from './cashflow-aggregates'

// ─── TUNABLE_CONSTANTS ───────────────────────────────────────────────────
// Revisit empirically after running on Wave 1 beta users.
//
// Reference points from the test personas:
//   - Maya (UK freelance designer):  runway 23d,  T3M income 2223, spend 1897 → surviving
//   - Carlos (Spain consultant):     runway 171d, T3M income 12100, spend 7888 → planning

const SURVIVING_RUNWAY_MAX = 30
const STABLE_RUNWAY_MAX = 90
const MIN_MONTHS_FOR_CONFIDENT_POSTURE = 3

const CONFIDENCE_FULL = 0.9
const CONFIDENCE_LOW_DATA = 0.65 // only 2 months observed
const CONFIDENCE_UNKNOWN_TRAJECTORY = 0.75
const CONFIDENCE_BOUNDARY = 0.7 // within ±10% of a posture boundary

// ─── Types ───────────────────────────────────────────────────────────────

export type FinancialPosture = 'surviving' | 'stable' | 'planning' | 'unknown'

export interface PostureResult {
  posture: FinancialPosture
  confidence: number
}

// ─── Detector ────────────────────────────────────────────────────────────

export function detectPosture(
  shape: IncomeShape,
  aggregates: CashFlowAggregates,
): PostureResult {
  const {
    runway_days,
    t3m_income_monthly,
    t3m_spend_monthly,
    balance_trajectory,
    months_observed,
  } = aggregates

  if (
    shape === 'unknown' ||
    runway_days === null ||
    t3m_income_monthly === null ||
    t3m_spend_monthly === null ||
    months_observed < 2
  ) {
    return { posture: 'unknown', confidence: 0 }
  }

  let posture: FinancialPosture
  if (runway_days < SURVIVING_RUNWAY_MAX) {
    posture = 'surviving'
  } else if (runway_days < STABLE_RUNWAY_MAX) {
    posture = 'stable'
  } else {
    // Runway >= 90: planning only if income covers spend.
    // Cushion alone isn't planning — could be burning down a windfall.
    posture =
      t3m_income_monthly >= t3m_spend_monthly ? 'planning' : 'stable'
  }

  let confidence = CONFIDENCE_FULL
  if (months_observed < MIN_MONTHS_FOR_CONFIDENT_POSTURE) {
    confidence = Math.min(confidence, CONFIDENCE_LOW_DATA)
  }
  if (balance_trajectory === 'unknown') {
    confidence = Math.min(confidence, CONFIDENCE_UNKNOWN_TRAJECTORY)
  }
  if (
    Math.abs(runway_days - SURVIVING_RUNWAY_MAX) <=
      SURVIVING_RUNWAY_MAX * 0.1 ||
    Math.abs(runway_days - STABLE_RUNWAY_MAX) <= STABLE_RUNWAY_MAX * 0.1
  ) {
    confidence = Math.min(confidence, CONFIDENCE_BOUNDARY)
  }

  return { posture, confidence: Math.round(confidence * 100) / 100 }
}
