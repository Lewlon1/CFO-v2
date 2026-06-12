// OB-1b — pinned band config for the estimates-first onboarding (v1).
//
// VERSIONING DISCIPLINE (same as value-map/alignment.ts): every midpoint
// below is pinned under ESTIMATE_ENGINE_VERSION. Changing ANY midpoint or
// band boundary is a NEW version — never edit v1 in place. Persisted
// derivations record the version they were computed under so cohorts stay
// comparable.
//
// Midpoints are currency-agnostic in v1: the same numerals serve GBP and
// EUR. Labels are bare numerals — the currency symbol is applied at render
// time, which is not this module's concern. UI components render their
// options from these config objects so the screen and the engine can never
// disagree about what a band means.

/** Single shared version for the band table AND the derivation formula. */
export const ESTIMATE_ENGINE_VERSION = 'v1' as const

export interface BandOption {
  /** Pinned monthly midpoint the derivation engine uses for this band. */
  midpoint: number
  /** Display label. Currency symbol is added at render time. */
  label: string
}

export type HousingBandId = 'a' | 'b' | 'c' | 'd'
export type SubsBandId = 'low' | 'mid' | 'high'
export type BillsBandId = 'a' | 'b' | 'c'
export type FoodOutBandId = 'a' | 'b' | 'c'
export type SaveReachBandId = 'a' | 'b' | 'c' | 'd'

export const HOUSING_BANDS: Record<HousingBandId, BandOption> = {
  a: { midpoint: 700, label: '<800' },
  b: { midpoint: 1000, label: '800–1,200' },
  c: { midpoint: 1400, label: '1,200–1,600' },
  d: { midpoint: 1800, label: '1,600+' },
}

/** Bands are subscription COUNTS; midpoints are pinned monthly costs.
 *  Ids are low|mid|high (not a|b|c like the amount bands) deliberately: this
 *  is a count tier whose midpoint is a modelled cost, and the divergent id
 *  scheme flags that different semantics at every call site. */
export const SUBS_BANDS: Record<SubsBandId, BandOption> = {
  low: { midpoint: 19, label: '0–3 subscriptions' },
  mid: { midpoint: 48, label: '4–7' },
  high: { midpoint: 86, label: '8+' },
}

export const BILLS_BANDS: Record<BillsBandId, BandOption> = {
  a: { midpoint: 150, label: '≈150' },
  b: { midpoint: 300, label: '≈300' },
  c: { midpoint: 500, label: '≈500' },
}

/** Labels are weekly spend; midpoints are pinned MONTHLY equivalents. */
export const FOOD_OUT_BANDS: Record<FoodOutBandId, BandOption> = {
  a: { midpoint: 60, label: '<20/week' },
  b: { midpoint: 150, label: '20–50/week' },
  c: { midpoint: 280, label: '50+/week' },
}

/** "How much could you comfortably put away each month?" */
export const SAVE_REACH_BANDS: Record<SaveReachBandId, BandOption> = {
  a: { midpoint: 0, label: 'nothing yet' },
  b: { midpoint: 100, label: '≈100' },
  c: { midpoint: 250, label: '≈250' },
  d: { midpoint: 500, label: '≈500' },
}

/** The five answers an onboarding user gives — one band id per question. */
export interface EstimateBands {
  housing: HousingBandId
  subs: SubsBandId
  bills: BillsBandId
  foodOut: FoodOutBandId
  saveReach: SaveReachBandId
}

export interface BandMidpoints {
  housingMid: number
  subsMid: number
  billsMid: number
  foodOutMid: number
  saveReachMid: number
}

/** Resolve the five chosen band ids to their pinned monthly midpoints. */
export function bandMidpoints(bands: EstimateBands): BandMidpoints {
  return {
    housingMid: HOUSING_BANDS[bands.housing].midpoint,
    subsMid: SUBS_BANDS[bands.subs].midpoint,
    billsMid: BILLS_BANDS[bands.bills].midpoint,
    foodOutMid: FOOD_OUT_BANDS[bands.foodOut].midpoint,
    saveReachMid: SAVE_REACH_BANDS[bands.saveReach].midpoint,
  }
}
