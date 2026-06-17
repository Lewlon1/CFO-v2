// VM-4 — deterministic archetype classifier (taxonomy v1).
//
// Pure function: answered cards in, classification out. No I/O, no LLM, no
// randomness. The locked rules:
//
//   family    = argmax over quadrants of (session share / population base
//               rate). Unnamed fallback when fewer than MIN_ANSWERED_CARDS
//               cards are answered or no ratio clears FALLBACK_MAX_RATIO.
//   certainty = composite of z-scores vs the pinned population medians:
//               (+avg confidence z) − (hard_to_decide rate z) − (median
//               deliberation z). Composite ≥ 0 → 'certain', else 'exploring'.
//
// The full working is persisted as a receipt so any classification can be
// reproduced and audited later. Raw telemetry lives in the receipt's
// certainty block for auditability — it is never rendered or prompted
// (band-telemetry.ts is the boundary for anything user- or LLM-facing).

import type { ValueQuadrant } from './types'
import {
  TAXONOMY_VERSION,
  BASE_RATES_V1,
  FALLBACK_MAX_RATIO,
  MIN_ANSWERED_CARDS,
  CERTAINTY_MEDIANS_V1,
  CERTAINTY_SPREADS_V1,
  FAMILIES,
  QUADRANT_FAMILY,
  ratioPhrase,
  type ArchetypeFamily,
  type CertaintyState,
} from './taxonomy-config'
import { summariseBands, type BandSummary } from './band-telemetry'

export interface AnsweredCard {
  quadrant: ValueQuadrant
  /** Conviction 1–5 as captured by the card UI. */
  confidence: number
  hardToDecide: boolean
  deliberationMs: number | null
}

export interface ClassificationReceipt {
  taxonomyVersion: typeof TAXONOMY_VERSION
  answeredCards: number
  countsByQuadrant: Record<ValueQuadrant, number>
  sharesByQuadrant: Record<ValueQuadrant, number>
  ratiosByQuadrant: Record<ValueQuadrant, number>
  winningQuadrant: ValueQuadrant | null
  winningRatio: number | null
  /** Deterministic phrase for the winning ratio (null on fallback). */
  ratioPhrase: string | null
  certainty: {
    avgConfidence: number
    hardRate: number
    medianDeliberationMs: number | null
    zConfidence: number
    zHardRate: number
    zDeliberation: number
    composite: number
  }
  bands: BandSummary
  fallbackReason: 'too_few_cards' | 'flat_ratios' | null
}

export interface ArchetypeClassification {
  taxonomyVersion: typeof TAXONOMY_VERSION
  family: ArchetypeFamily | null
  certainty: CertaintyState | null
  /** e.g. "The Fortress"; null = the "still reading you" fallback state. */
  displayName: string | null
  usedFallback: boolean
  receipt: ClassificationReceipt
}

const QUADRANTS: ValueQuadrant[] = ['foundation', 'investment', 'burden', 'leak']

const round4 = (n: number) => Math.round(n * 10000) / 10000

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * z-score with a degenerate-spread guard: the pinned hardRate spread is 0
 * (nobody in the calibration population flagged hard-to-decide), so any
 * deviation above the median maps to a fixed +2 — present-but-unscalable
 * signal, bounded so one component can't swamp the composite.
 */
function zScore(value: number, medianValue: number, spread: number): number {
  if (spread <= 0) {
    if (value === medianValue) return 0
    return value > medianValue ? 2 : -2
  }
  return (value - medianValue) / spread
}

export function classifyArchetype(cards: readonly AnsweredCard[]): ArchetypeClassification {
  const n = cards.length

  const counts: Record<ValueQuadrant, number> = {
    foundation: 0,
    investment: 0,
    burden: 0,
    leak: 0,
  }
  for (const card of cards) counts[card.quadrant] += 1

  const shares = {} as Record<ValueQuadrant, number>
  const ratios = {} as Record<ValueQuadrant, number>
  for (const q of QUADRANTS) {
    shares[q] = n > 0 ? round4(counts[q] / n) : 0
    ratios[q] = n > 0 ? round4(counts[q] / n / BASE_RATES_V1[q]) : 0
  }

  // argmax with a deterministic tie-break: fixed quadrant order above.
  let winningQuadrant: ValueQuadrant | null = null
  let winningRatio = -Infinity
  for (const q of QUADRANTS) {
    if (ratios[q] > winningRatio) {
      winningQuadrant = q
      winningRatio = ratios[q]
    }
  }

  // Certainty composite — computed regardless of fallback so the receipt is
  // always complete, but only surfaced when a family is assigned.
  const avgConfidence = n > 0 ? round4(cards.reduce((a, c) => a + c.confidence, 0) / n) : 0
  const hardRate = n > 0 ? round4(cards.filter((c) => c.hardToDecide).length / n) : 0
  const medianDelib = median(
    cards
      .map((c) => c.deliberationMs)
      .filter((ms): ms is number => ms != null && Number.isFinite(ms) && ms >= 0),
  )

  const zConfidence = round4(
    zScore(avgConfidence, CERTAINTY_MEDIANS_V1.avgConfidence, CERTAINTY_SPREADS_V1.avgConfidence),
  )
  const zHardRate = round4(
    zScore(hardRate, CERTAINTY_MEDIANS_V1.hardRate, CERTAINTY_SPREADS_V1.hardRate),
  )
  // No deliberation telemetry at all → component contributes 0 (median, by
  // definition of z=0) rather than inventing a speed signal.
  const zDeliberation = round4(
    medianDelib == null
      ? 0
      : zScore(medianDelib, CERTAINTY_MEDIANS_V1.deliberationMs, CERTAINTY_SPREADS_V1.deliberationMs),
  )
  const composite = round4(zConfidence - zHardRate - zDeliberation)

  const fallbackReason: ClassificationReceipt['fallbackReason'] =
    n < MIN_ANSWERED_CARDS
      ? 'too_few_cards'
      : winningQuadrant == null || winningRatio < FALLBACK_MAX_RATIO
        ? 'flat_ratios'
        : null
  const usedFallback = fallbackReason !== null

  const family = usedFallback ? null : QUADRANT_FAMILY[winningQuadrant as ValueQuadrant]
  const certainty: CertaintyState | null = usedFallback ? null : composite >= 0 ? 'certain' : 'exploring'
  const displayName = family && certainty ? FAMILIES[family][certainty] : null

  return {
    taxonomyVersion: TAXONOMY_VERSION,
    family,
    certainty,
    displayName,
    usedFallback,
    receipt: {
      taxonomyVersion: TAXONOMY_VERSION,
      answeredCards: n,
      countsByQuadrant: counts,
      sharesByQuadrant: shares,
      ratiosByQuadrant: ratios,
      winningQuadrant: usedFallback && n === 0 ? null : winningQuadrant,
      winningRatio: usedFallback && n === 0 ? null : round4(winningRatio),
      ratioPhrase: usedFallback ? null : ratioPhrase(winningRatio),
      certainty: {
        avgConfidence,
        hardRate,
        medianDeliberationMs: medianDelib,
        zConfidence,
        zHardRate,
        zDeliberation,
        composite,
      },
      bands: summariseBands(cards),
      fallbackReason,
    },
  }
}
