// OB-1c — estimate-vs-reality comparison engine (v1). Pure over PRE-FETCHED
// actuals: the OB-3 wiring fetches the real numbers from transactions and
// snapshots; this module only compares them with the pinned band midpoints.
// "The LLM interprets, the system computes" — the reality-check Read cites
// these deltas verbatim, it never re-derives them.
//
// FORMULA VERSIONING DISCIPLINE (same as bands.ts/derive.ts): the v1 rule
// below — "the guess held" when |delta| <= max(30, 0.15 × estimate) — is
// pinned. It is never edited in place; a change is a NEW version, and every
// persisted verification records the version it was computed under.

import { bandMidpoints, type EstimateBands } from './bands'

export const DELTA_ENGINE_VERSION = 'v1' as const

// Pinned v1 "guess held" constants. New values = new engine version.
const HELD_FLOOR = 30
const HELD_PCT = 0.15

/** Pinned note for a save-reach figure derived from the income-minus-spend
 *  leftover proxy rather than detected transfers. Deterministic — the Read
 *  composer quotes it, never paraphrases it, so it may reach the user
 *  verbatim and must stay in plain words. */
export const SAVE_REACH_PROXY_NOTE =
  'worked out from what was left over, not from detected transfers' as const

export type DeltaBandKey =
  | 'housing'
  | 'subscriptions'
  | 'bills'
  | 'food_out'
  | 'save_reach'

export interface BandActuals {
  /** monthly_rent or reconciled housing fixed-cost. */
  housing: number | null
  /** Detected recurring subscription monthly total. */
  subscriptions: number | null
  /** Reconciled fixed total minus housing. */
  bills: number | null
  /** Eating-out monthly equivalent from the spending breakdown. */
  foodOut: number | null
  /** Detected savings transfers, or income-minus-tracked-spend proxy. */
  saveReach: number | null
  /** True when saveReach came from the leftover proxy, not real transfers. */
  saveReachIsProxy?: boolean
}

// Deliberately flat (nullable fields, not a discriminated union on state):
// the shape mirrors what lands in jsonb, where unions don't survive anyway.
export interface BandDelta {
  band: DeltaBandKey
  state: 'verified' | 'estimated'
  /** The pinned band midpoint from bands.ts. */
  estimate: number
  actual: number | null
  /** actual − estimate, rounded to whole units (positive = reality higher
   *  than the guess). Null while unverified. */
  delta: number | null
  /** Verified only: |delta| <= max(30, 0.15 × estimate) — the pinned
   *  "the guess held" rule, judged on the rounded delta. Distinct from
   *  DeltaResult.held, the list of bands where this flag is true. */
  held: boolean | null
  /** e.g. SAVE_REACH_PROXY_NOTE when the save-reach actual is a proxy. */
  note: string | null
}

export interface DeltaResult {
  engine_version: typeof DELTA_ENGINE_VERSION
  /** All five bands, fixed order housing → subscriptions → bills →
   *  food_out → save_reach. */
  bands: BandDelta[]
  verifiedCount: number
  /** The verified band with the largest |delta| among NOT-held bands (ties
   *  break by band order); null if none. This is what the reality-check
   *  Read opens with. */
  sharpest: BandDelta | null
  /** Verified bands where the guess held — the Read says so plainly.
   *  Distinct from BandDelta.held, the per-band tri-state flag this list
   *  filters on. */
  held: BandDelta[]
}

/** v1 "guess held": within ±30 whole units or ±15% of the estimate,
 *  whichever is wider. */
const guessHeld = (delta: number, estimate: number): boolean =>
  Math.abs(delta) <= Math.max(HELD_FLOOR, HELD_PCT * estimate)

const toDelta = (
  band: DeltaBandKey,
  estimate: number,
  actual: number | null,
  note: string | null = null,
): BandDelta => {
  if (actual === null) {
    return { band, state: 'estimated', estimate, actual: null, delta: null, held: null, note: null }
  }
  const delta = Math.round(actual - estimate)
  return {
    band,
    state: 'verified',
    estimate,
    actual,
    delta,
    held: guessHeld(delta, estimate),
    note,
  }
}

/**
 * Compare the five band estimates with pre-fetched actuals. Pure and
 * deterministic — no fetching, no clock, no rounding beyond the pinned
 * whole-unit delta.
 */
export function computeDeltas(
  estimateBands: EstimateBands,
  actuals: BandActuals,
): DeltaResult {
  const { housingMid, subsMid, billsMid, foodOutMid, saveReachMid } =
    bandMidpoints(estimateBands)

  const bands: BandDelta[] = [
    toDelta('housing', housingMid, actuals.housing),
    toDelta('subscriptions', subsMid, actuals.subscriptions),
    toDelta('bills', billsMid, actuals.bills),
    toDelta('food_out', foodOutMid, actuals.foodOut),
    toDelta(
      'save_reach',
      saveReachMid,
      actuals.saveReach,
      actuals.saveReach !== null && actuals.saveReachIsProxy === true
        ? SAVE_REACH_PROXY_NOTE
        : null,
    ),
  ]

  const verified = bands.filter((b) => b.state === 'verified')

  // Largest |delta| among the verified-but-not-held bands; ties break by
  // band order because reduce only replaces on a strictly larger |delta|.
  const sharpest = verified
    .filter((b) => b.held === false)
    .reduce<BandDelta | null>(
      (best, b) =>
        best === null || Math.abs(b.delta ?? 0) > Math.abs(best.delta ?? 0)
          ? b
          : best,
      null,
    )

  return {
    engine_version: DELTA_ENGINE_VERSION,
    bands,
    verifiedCount: verified.length,
    sharpest,
    held: verified.filter((b) => b.held === true),
  }
}

export interface VerificationJsonEntry {
  state: BandDelta['state']
  estimate: number
  actual: number | null
  delta: number | null
}

export interface VerificationJson {
  /** The engine version the deltas were computed under — persisted with
   *  them so stored verifications stay comparable across versions. */
  engine_version: typeof DELTA_ENGINE_VERSION
  bands: Record<DeltaBandKey, VerificationJsonEntry>
}

/**
 * The shape persisted to `onboarding_estimates.verification`:
 * `{ engine_version, bands: { <band>: { state, estimate, actual, delta } } }`.
 * Deliberately timestamp-free — the write site stamps verified_at; this
 * module stays pure.
 */
export function toVerificationJson(result: DeltaResult): VerificationJson {
  const bands = {} as Record<DeltaBandKey, VerificationJsonEntry>
  for (const b of result.bands) {
    bands[b.band] = {
      state: b.state,
      estimate: b.estimate,
      actual: b.actual,
      delta: b.delta,
    }
  }
  return { engine_version: result.engine_version, bands }
}
