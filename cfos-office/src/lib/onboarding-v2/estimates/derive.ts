// OB-1b — the deterministic estimate engine (v1). "The LLM interprets, the
// system computes": everything here is pure arithmetic over the five band
// midpoints plus the user's stated income and goal. The output is persisted
// to onboarding_estimates.derived verbatim and handed to the read composer —
// the LLM cites these numbers, it never re-derives them.
//
// FORMULA VERSIONING DISCIPLINE (same as value-map/alignment.ts): the v1
// math below mirrors the approved prototype and is pinned. It is never
// edited in place — a change is a NEW version (shared with bands.ts via
// ESTIMATE_ENGINE_VERSION), and every persisted derivation records the
// version it was computed under.

import {
  ESTIMATE_ENGINE_VERSION,
  bandMidpoints,
  type EstimateBands,
} from './bands'

export interface DeriveGoalInput {
  targetAmount: number
  currentAmount: number
  monthsToDeadline: number | null
}

export interface DeriveInput {
  /** Stated monthly income. The v1 formula assumes income > 0. */
  income: number
  bands: EstimateBands
  goal: DeriveGoalInput | null
}

export type ActionBranch = 'starter_transfer' | 'payday_boost' | 'accuracy_first'
export type PaceVerdict = 'steep' | 'doable'

export interface DerivedEstimates {
  /** snake_case (vs alignment.ts's `version`) is deliberate: migration 074's
   *  comments anchor the persisted jsonb key as `engine_version`. */
  engine_version: typeof ESTIMATE_ENGINE_VERSION
  /** Echoed inputs' monthly midpoints so the composer can cite them without
   *  re-deriving. */
  housingMonthly: number
  subsMonthly: number
  billsMonthly: number
  foodOutMonthly: number
  saveMonthly: number
  /** round10(housingMonthly + subsMonthly + billsMonthly) */
  fixedBase: number
  /** income − fixedBase */
  freeCash: number
  /** max(0, freeCash − saveMonthly − foodOutMonthly) — the unexplained
   *  slice. */
  drift: number
  /** (freeCash − foodOutMonthly) < (saveMonthly + 120): too little headroom
   *  to lever. */
  tight: boolean
  /** min(300, round10(drift / 2)); null when tight. WARNING: gated by
   *  `tight` only, NOT by branch — it can be non-null on the
   *  starter_transfer branch. Composers must key off `actionBranch`, never
   *  off leverAmount's nullability. */
  leverAmount: number | null
  /** max(0, target − current); null without a goal. */
  remaining: number | null
  /** ceil(remaining / saveMonthly); null without a goal or with
   *  saveMonthly = 0. */
  monthsAtCurrent: number | null
  /** ceil(remaining / (saveMonthly + leverAmount)); null without a goal or
   *  lever. */
  monthsAtBoosted: number | null
  actionBranch: ActionBranch
  /** Only for the starter_transfer branch; null otherwise. */
  starterAmount: number | null
  /** round10(remaining / monthsToDeadline); deadline-pace fields are null
   *  unless the goal has a positive monthsToDeadline. */
  requiredMonthly: number | null
  requiredPctOfIncome: number | null
  paceVerdict: PaceVerdict | null
}

/** Pinned v1 rounding: nearest 10, halves up. Pinned under
 *  ESTIMATE_ENGINE_VERSION — not a general utility; do not import it outside
 *  the estimates engine. */
export const round10 = (n: number): number => Math.round(n / 10) * 10

// Pinned v1 constants. New values = new engine version.
const TIGHT_BUFFER = 120
const LEVER_CAP = 300
const STARTER_FLOOR = 50
const STARTER_CAP = 150
const STARTER_FALLBACK = 100
const STEEP_PCT_THRESHOLD = 50

/**
 * v1 FORMULA (pinned — mirrors the approved prototype; `save`/`food` are the
 * saveMonthly/foodOutMonthly output fields):
 *
 *   fixedBase  = round10(housingMonthly + subsMonthly + billsMonthly)
 *   freeCash   = income − fixedBase
 *   drift      = max(0, freeCash − save − food)
 *   tight      = (freeCash − food) < (save + 120)
 *   leverAmount = tight ? null : min(300, round10(drift / 2))
 *   remaining  = goal ? max(0, target − current) : null
 *   monthsAtCurrent = ceil(remaining / save)            when save > 0
 *   monthsAtBoosted = ceil(remaining / (save + lever))  when lever held
 *
 *   actionBranch (pinned precedence):
 *     save === 0     → starter_transfer,
 *                      starterAmount = max(50, round10(min(150, drift/2 || 100)))
 *     else if !tight → payday_boost (uses leverAmount)
 *     else           → accuracy_first
 *
 *   NOTE: leverAmount is gated by `tight` alone, NOT by branch — on the
 *   starter_transfer branch (save = 0 with ample drift) it can still be
 *   non-null. Composers key off actionBranch, never off leverAmount.
 *
 *   deadline pace (only when the goal has a positive monthsToDeadline):
 *     requiredMonthly     = round10(remaining / monthsToDeadline)
 *     requiredPctOfIncome = round((requiredMonthly / income) × 100)
 *     paceVerdict         = pct > 50 ? steep : doable
 */
export function deriveEstimates(input: DeriveInput): DerivedEstimates {
  const { income, goal } = input
  const { housingMid, subsMid, billsMid, foodOutMid, saveReachMid } =
    bandMidpoints(input.bands)

  const saveMonthly = saveReachMid
  const foodOutMonthly = foodOutMid

  const fixedBase = round10(housingMid + subsMid + billsMid)
  const freeCash = income - fixedBase

  // The unexplained slice: cash that is neither fixed, food out, nor saved.
  const drift = Math.max(0, freeCash - saveMonthly - foodOutMonthly)

  // With less than save + buffer left after food there is no honest headroom
  // to suggest a boost from band-level estimates alone.
  const tight = freeCash - foodOutMonthly < saveMonthly + TIGHT_BUFFER

  const leverAmount = tight ? null : Math.min(LEVER_CAP, round10(drift / 2))

  const remaining =
    goal !== null ? Math.max(0, goal.targetAmount - goal.currentAmount) : null
  const monthsAtCurrent =
    remaining !== null && saveMonthly > 0
      ? Math.ceil(remaining / saveMonthly)
      : null
  // The `saveMonthly + leverAmount > 0` guard is defensive only —
  // unreachable-false under v1 constants (leverAmount ≥ 60 whenever non-null).
  const monthsAtBoosted =
    remaining !== null && leverAmount !== null && saveMonthly + leverAmount > 0
      ? Math.ceil(remaining / (saveMonthly + leverAmount))
      : null

  // Pinned action precedence: no savings habit at all beats everything —
  // start one. Otherwise boost when there's headroom; otherwise the honest
  // move is tightening the estimates first.
  let actionBranch: ActionBranch
  let starterAmount: number | null = null
  if (saveMonthly === 0) {
    actionBranch = 'starter_transfer'
    // `drift / 2 || 100`: when drift is 0 the half is falsy, so fall back to
    // 100 before clamping into [50, 150].
    starterAmount = Math.max(
      STARTER_FLOOR,
      round10(Math.min(STARTER_CAP, drift / 2 || STARTER_FALLBACK)),
    )
  } else if (!tight) {
    actionBranch = 'payday_boost'
  } else {
    actionBranch = 'accuracy_first'
  }

  // Deadline pace, for the income beat — only when the goal carries a
  // positive monthsToDeadline.
  let requiredMonthly: number | null = null
  let requiredPctOfIncome: number | null = null
  let paceVerdict: PaceVerdict | null = null
  if (
    remaining !== null &&
    goal !== null &&
    goal.monthsToDeadline !== null &&
    goal.monthsToDeadline > 0
  ) {
    requiredMonthly = round10(remaining / goal.monthsToDeadline)
    requiredPctOfIncome = Math.round((requiredMonthly / income) * 100)
    paceVerdict = requiredPctOfIncome > STEEP_PCT_THRESHOLD ? 'steep' : 'doable'
  }

  return {
    engine_version: ESTIMATE_ENGINE_VERSION,
    housingMonthly: housingMid,
    subsMonthly: subsMid,
    billsMonthly: billsMid,
    foodOutMonthly,
    saveMonthly,
    fixedBase,
    freeCash,
    drift,
    tight,
    leverAmount,
    remaining,
    monthsAtCurrent,
    monthsAtBoosted,
    actionBranch,
    starterAmount,
    requiredMonthly,
    requiredPctOfIncome,
    paceVerdict,
  }
}

// Pinned, locale-independent: addMonthsLabel must render identically on
// every server.
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * "October 2028"-style label for the month `months` after `reference`, for
 * "goal lands <date>" rendering. The reference date is a parameter — no
 * Date.now() inside the engine, so derivation stays pure. Anchored to day 1
 * so end-of-month reference days cannot overflow into the wrong month.
 */
export function addMonthsLabel(reference: Date, months: number): string {
  const landed = new Date(
    reference.getFullYear(),
    reference.getMonth() + months,
    1,
  )
  return `${MONTH_NAMES[landed.getMonth()]} ${landed.getFullYear()}`
}
