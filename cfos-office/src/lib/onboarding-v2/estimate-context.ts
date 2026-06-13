// OB-2 — the data bundle the estimates-first beats render from. Assembled
// server-side by the office layout (from user_profiles + onboarding_estimates)
// and threaded through ChatProvider → ChatSheet → estimate-beat-host → beats.
// Beats are deterministic: they render from this context and call the
// estimate-actions; no LLM tool calls, no client DB reads.

import type { KnowsYouResult } from './knows-you'
import type { DoorFamily } from './door/door-config'
import type { CompositeCountry } from './composite/composite-config'

/** Band ids already tapped (null until tapped), for sketch resume. */
export interface EstimateBeatBands {
  housing: string | null
  subs: string | null
  bills: string | null
  foodOut: string | null
  saveReach: string | null
}

export interface EstimateOnboardingContext {
  /** The deterministic "C. knows you · n%" score, for the status-line meter. */
  knowsYou: KnowsYouResult
  /** Prefill for the door beat's name input (display_name / OAuth name). */
  displayName: string | null
  /** Effective door family (composite re-pick ?? door_family ?? struggle map). */
  doorFamily: DoorFamily | null
  /** The reflection played back after the door beat, if already classified. */
  doorReflection: string | null
  /** UK/ES — drives the composite persona skin and goal targets. */
  country: CompositeCountry
  /** Resolved currency for the flow (GBP/EUR). */
  currency: string
  /** Bands tapped so far, for the sketch beat. */
  bands: EstimateBeatBands
  /** Stated income, if the income beat has run. */
  income: number | null
}
