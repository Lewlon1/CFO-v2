// OB-2 — estimate-flow resume resolver.
//
// Given what the user has already given us (door columns + onboarding_estimates
// row + a couple of profile facts), returns the FIRST incomplete estimate beat.
// Used by the office layout to:
//   1. map a brand-new user (onboarding_step null) onto 'estimate_door', and
//   2. forward-route a legacy mid-flow user (intro_shown, goal_chat_*,
//      goal_set/skipped, essentials_done, upload_pending) into the estimate
//      flow at the right point, skipping beats whose data already exists.
//
// It is data-driven and idempotent: every estimate action both writes its data
// AND advances onboarding_step, so the stamped estimate step and this resolver
// always agree. The layout uses the stamped step directly once the user is on
// an estimate_* step; this resolver only governs the entry mapping.
//
// Family is always resolvable: a legacy user with entry_struggle but no
// door_family reverse-maps (struggleToFamily), so the door beat is correctly
// treated as done and downstream beats derive the family from entry_struggle.

import type { OnboardingStep } from './types'
import { struggleToFamily } from './door/door-config'

/** Everything the resolver needs, assembled by the layout from user_profiles +
 *  onboarding_estimates. All fields tolerate null so a thin profile resolves
 *  cleanly to 'estimate_door'. */
export interface EstimateResumeSignals {
  /** user_profiles.door_family — set when the door beat classifies. */
  doorFamily: string | null
  /** user_profiles.entry_struggle — legacy door signal, reverse-mappable. */
  entryStruggle: string | null
  /** user_profiles.age_range — the context beat's marker (signup never sets it). */
  ageRange: string | null
  /** user_profiles.country — used alongside age_range for the context marker. */
  country: string | null
  /** user_profiles.composite_relate — the composite beat's marker. */
  compositeRelate: string | null
  /** An active goals row exists (the goal beat creates one). */
  hasGoal: boolean
  /** onboarding_estimates.income_monthly ?? user_profiles.net_monthly_income. */
  incomeMonthly: number | null
  /** Count of non-null band columns on the estimates row (0–5). */
  sketchBandsCount: number
  /** onboarding_estimates.top_value. */
  topValue: string | null
  /** Number of keys in onboarding_estimates.verdicts. */
  verdictsCount: number
}

/** All five sketch bands tapped. */
const SKETCH_BANDS_REQUIRED = 5
/** Top value + the three domain verdicts (subs / food_out / drift). */
const VERDICTS_REQUIRED = 3

/**
 * Resolve the first incomplete estimate beat. Returns an `estimate_*`
 * OnboardingStep; never throws. The order mirrors the flow:
 *   door → context → composite → goal → income → sketch → verdicts → read.
 */
export function resolveEstimateResume(
  signals: EstimateResumeSignals,
): OnboardingStep {
  const doorDone =
    signals.doorFamily != null || struggleToFamily(signals.entryStruggle) != null
  if (!doorDone) return 'estimate_door'

  // The context beat is the only writer of age_range; signup may pre-set
  // country, so age_range (not country) is the marker that the beat ran.
  const contextDone = signals.ageRange != null
  if (!contextDone) return 'estimate_context'

  if (signals.compositeRelate == null) return 'estimate_composite'

  if (!signals.hasGoal) return 'estimate_goal'

  if (signals.incomeMonthly == null) return 'estimate_income'

  if (signals.sketchBandsCount < SKETCH_BANDS_REQUIRED) return 'estimate_sketch'

  if (signals.topValue == null || signals.verdictsCount < VERDICTS_REQUIRED) {
    return 'estimate_verdicts'
  }

  return 'estimate_read_pending'
}
