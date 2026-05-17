// Agreement metric + bootstrap confidence interval.
//
// For each rated pair, classify the (lewis_winner, judge_winner) pick pair:
//   match      — both picked the same side                  → full credit (1.0)
//   half_match — exactly one said tie, the other picked a/b → 0.5 credit
//   miss       — opposing picks (a/b or b/a)                → 0 credit
//
// agreement = (#match + 0.5 * #half_match) / #rated_pairs
//
// Bootstrap CI: resample pairs with replacement N times, recompute agreement
// each time, take the 2.5th and 97.5th percentiles for the 95% CI. With ~30
// pairs and 1000 resamples this is cheap (sub-second).

import type { Winner } from './pair-storage'

export type Verdict = 'match' | 'half_match' | 'miss'

export function classify(lewisPick: Winner, judgePick: Winner): Verdict {
  if (lewisPick === judgePick) return 'match'
  const lewisTie = lewisPick === 'tie'
  const judgeTie = judgePick === 'tie'
  if (lewisTie !== judgeTie) return 'half_match'
  // Both non-tie, different → miss (a/b or b/a)
  return 'miss'
}

export function verdictCredit(v: Verdict): number {
  if (v === 'match') return 1
  if (v === 'half_match') return 0.5
  return 0
}

export interface AgreementResult {
  count: number
  matches: number
  half_matches: number
  misses: number
  agreement: number              // [0,1]
  /** Optional 95% CI computed by bootstrap. */
  ci95?: { low: number; high: number }
}

export function computeAgreement(
  pairs: Array<{ lewis: Winner; judge: Winner }>,
  opts: { bootstrap?: number } = {},
): AgreementResult {
  const n = pairs.length
  if (n === 0) {
    return { count: 0, matches: 0, half_matches: 0, misses: 0, agreement: 0 }
  }

  let matches = 0
  let half_matches = 0
  let misses = 0
  let creditSum = 0
  const credits: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const v = classify(pairs[i].lewis, pairs[i].judge)
    const c = verdictCredit(v)
    credits[i] = c
    creditSum += c
    if (v === 'match') matches++
    else if (v === 'half_match') half_matches++
    else misses++
  }
  const agreement = creditSum / n

  const result: AgreementResult = { count: n, matches, half_matches, misses, agreement }

  const bootstrap = opts.bootstrap ?? 0
  if (bootstrap > 0) {
    result.ci95 = bootstrapCI(credits, bootstrap)
  }

  return result
}

// ── Bootstrap CI ──────────────────────────────────────────────────────────────
// Resample credits-array with replacement; recompute mean; return 2.5/97.5
// percentiles. Deterministic with a seeded RNG so tournament runs are
// reproducible across invocations on the same golden set.

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function bootstrapCI(
  credits: number[],
  iterations: number,
  seed = 42,
): { low: number; high: number } {
  const n = credits.length
  if (n === 0) return { low: 0, high: 0 }
  const rng = mulberry32(seed)
  const means: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) {
      sum += credits[Math.floor(rng() * n)]
    }
    means[i] = sum / n
  }
  means.sort((a, b) => a - b)
  const lowIdx = Math.floor(0.025 * iterations)
  const highIdx = Math.floor(0.975 * iterations)
  return { low: means[lowIdx], high: means[highIdx] }
}

// ── Promotion eligibility ─────────────────────────────────────────────────────
// Strict rule from the design:
//   train  ≥ champion.train  + minDelta
//   holdout ≥ champion.holdout + minDelta
//   candidate.holdout 95% CI lower bound > champion.holdout point estimate

export interface PromotionInput {
  champion: { train: AgreementResult; holdout: AgreementResult }
  candidate: { train: AgreementResult; holdout: AgreementResult }
  minDelta?: number              // default 0.02 (+2pp)
}

export interface PromotionDecision {
  eligible: boolean
  reason: string
}

export function checkPromotion(input: PromotionInput): PromotionDecision {
  const minDelta = input.minDelta ?? 0.02
  const trainDelta = input.candidate.train.agreement - input.champion.train.agreement
  const holdoutDelta = input.candidate.holdout.agreement - input.champion.holdout.agreement

  if (trainDelta < minDelta) {
    return {
      eligible: false,
      reason: `train agreement only +${(trainDelta * 100).toFixed(1)}pp (need +${(minDelta * 100).toFixed(1)}pp)`,
    }
  }
  if (holdoutDelta < minDelta) {
    return {
      eligible: false,
      reason: `holdout agreement only +${(holdoutDelta * 100).toFixed(1)}pp (need +${(minDelta * 100).toFixed(1)}pp)`,
    }
  }
  const candidateCI = input.candidate.holdout.ci95
  if (!candidateCI) {
    return {
      eligible: false,
      reason: 'candidate holdout CI missing — re-run tournament with bootstrap',
    }
  }
  if (candidateCI.low <= input.champion.holdout.agreement) {
    return {
      eligible: false,
      reason: `candidate holdout CI lower bound ${(candidateCI.low * 100).toFixed(1)}% does not exceed champion point estimate ${(input.champion.holdout.agreement * 100).toFixed(1)}%`,
    }
  }
  return {
    eligible: true,
    reason: `train +${(trainDelta * 100).toFixed(1)}pp, holdout +${(holdoutDelta * 100).toFixed(1)}pp, holdout CI [${(candidateCI.low * 100).toFixed(1)}%, ${(candidateCI.high * 100).toFixed(1)}%]`,
  }
}
