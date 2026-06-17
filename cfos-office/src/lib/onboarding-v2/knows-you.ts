// OB-1c — the "C. knows you · n%" meter (v1). A deterministic completeness
// score over onboarding signals: every point is earned by a concrete signal
// the user gave, so the meter can never claim knowledge it doesn't have.
//
// WEIGHT VERSIONING DISCIPLINE (same as value-map/alignment.ts and
// estimates/derive.ts): the v1 weights below are pinned. They are never
// edited in place — changing ANY weight is a NEW version, so logged
// percentages stay comparable across cohorts.
//
// Two deliberate ceilings:
//   · estimate-stage signals sum to exactly 56 — the cap before any real
//     statement has been seen. Estimates alone never read as "mostly known".
//   · the all-true total is 80, not 100 — the meter never claims complete
//     knowledge of a person.
//
// NOTE: do NOT confuse this score with the unrelated
// `user_profiles.profile_completeness` column. This score is computed on
// demand and never stored — the composed % gets logged into conversation
// metadata at compose time by the caller, nothing else persists it.

export const KNOWS_YOU_VERSION = 'v1' as const

/** Pinned v1 weights. New values = new KNOWS_YOU_VERSION. */
export const KNOWS_YOU_WEIGHTS = {
  name: 4,
  door: 8,
  context: 4,
  compositeRelate: 4,
  goal: 8,
  income: 8,
  /** 2 points per sketched band, five bands → max 10. */
  sketchPerBand: 2,
  sketchMax: 10,
  topValue: 4,
  /** 2 points per verdict, three verdicts → max 6. */
  verdictPer: 2,
  verdictsMax: 6,
  // Post-estimate signals — the only way past 56.
  statementChecked: 16,
  valueMapDone: 8,
} as const

// Count ceilings, derived from the weights table above so the per-unit /
// maximum relation is single-sourced: max count × per-unit weight = pinned max.
export const SKETCH_BANDS_MAX =
  KNOWS_YOU_WEIGHTS.sketchMax / KNOWS_YOU_WEIGHTS.sketchPerBand
export const VERDICTS_MAX =
  KNOWS_YOU_WEIGHTS.verdictsMax / KNOWS_YOU_WEIGHTS.verdictPer

export interface KnowsYouSignals {
  hasName: boolean
  /** Door question answered (family classified or chip-picked). */
  hasDoor: boolean
  /** Country + age band. */
  hasContext: boolean
  /** Responded to the composite intro (any of spot_on/close/not_me). */
  hasCompositeRelate: boolean
  /** Goal + deadline beat completed. */
  hasGoal: boolean
  hasIncome: boolean
  /** 0–5; out-of-range values are clamped. */
  sketchBandsCount: number
  hasTopValue: boolean
  /** 0–3; out-of-range values are clamped. */
  verdictsCount: number
  /** At least one band verified against a real statement (OB-3). */
  statementChecked: boolean
  /** Post-statement VM-3 session completed. */
  valueMapDone: boolean
}

export type KnowsYouPartKey =
  | 'name'
  | 'door'
  | 'context'
  | 'composite_relate'
  | 'goal'
  | 'income'
  | 'sketch'
  | 'top_value'
  | 'verdicts'
  | 'statement_checked'
  | 'value_map_done'

export interface KnowsYouPart {
  key: KnowsYouPartKey
  /** Plain user-facing words — rendered directly in the meter breakdown. */
  label: string
  earned: number
  weight: number
}

export interface KnowsYouResult {
  /** The weight version this score was computed under — carried on the
   *  result so persistence/logging sites can never forget to record it. */
  version: typeof KNOWS_YOU_VERSION
  /** Integer 0–80: the sum of earned weights. All weights are integers, so
   *  no rounding is ever involved. */
  pct: number
  parts: KnowsYouPart[]
}

/** Clamp a count into [0, max], dropping any fractional part. */
const clampCount = (n: number, max: number): number =>
  Math.max(0, Math.min(max, Math.floor(n)))

/**
 * Score the meter from onboarding signals. Pure and deterministic — same
 * signals, same number, always.
 */
export function knowsYou(signals: KnowsYouSignals): KnowsYouResult {
  const w = KNOWS_YOU_WEIGHTS
  const sketchEarned =
    clampCount(signals.sketchBandsCount, SKETCH_BANDS_MAX) * w.sketchPerBand
  const verdictsEarned =
    clampCount(signals.verdictsCount, VERDICTS_MAX) * w.verdictPer

  const parts: KnowsYouPart[] = [
    {
      key: 'name',
      label: 'your name',
      earned: signals.hasName ? w.name : 0,
      weight: w.name,
    },
    {
      key: 'door',
      label: 'what brought you in',
      earned: signals.hasDoor ? w.door : 0,
      weight: w.door,
    },
    {
      key: 'context',
      label: 'where life is',
      earned: signals.hasContext ? w.context : 0,
      weight: w.context,
    },
    {
      key: 'composite_relate',
      label: 'how close the sketch is',
      earned: signals.hasCompositeRelate ? w.compositeRelate : 0,
      weight: w.compositeRelate,
    },
    {
      key: 'goal',
      label: 'the goal',
      earned: signals.hasGoal ? w.goal : 0,
      weight: w.goal,
    },
    {
      key: 'income',
      label: 'what lands each month',
      earned: signals.hasIncome ? w.income : 0,
      weight: w.income,
    },
    {
      key: 'sketch',
      label: 'your month, sketched',
      earned: sketchEarned,
      weight: w.sketchMax,
    },
    {
      key: 'top_value',
      label: 'what matters most',
      earned: signals.hasTopValue ? w.topValue : 0,
      weight: w.topValue,
    },
    {
      key: 'verdicts',
      label: 'your verdicts',
      earned: verdictsEarned,
      weight: w.verdictsMax,
    },
    {
      key: 'statement_checked',
      label: 'checked against a statement',
      earned: signals.statementChecked ? w.statementChecked : 0,
      weight: w.statementChecked,
    },
    {
      key: 'value_map_done',
      label: 'what you value, mapped',
      earned: signals.valueMapDone ? w.valueMapDone : 0,
      weight: w.valueMapDone,
    },
  ]

  const pct = parts.reduce((sum, p) => sum + p.earned, 0)

  return { version: KNOWS_YOU_VERSION, pct, parts }
}
