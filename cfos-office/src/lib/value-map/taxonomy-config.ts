// VM-4 — locked archetype taxonomy v1.
//
// The system computes the user's position (family × certainty); the LLM only
// narrates inside the assigned cell. Every constant below is pinned from
// staging data — recalibration means a NEW taxonomy version, never an edit
// to v1 (retake comparability depends on the constants being frozen).

import type { ValueQuadrant } from './types'

export const TAXONOMY_VERSION = 'v1' as const

export type ArchetypeFamily = 'growth' | 'security' | 'agency' | 'candor'
export type CertaintyState = 'certain' | 'exploring'

/**
 * Population base rates per quadrant over all answered cards.
 * Pinned 2026-06-10 from staging (qlbhvlssksnrhsleadzn), n=793 answered
 * cards: foundation 367 · investment 230 · burden 135 · leak 61.
 */
export const BASE_RATES_V1: Record<ValueQuadrant, number> = {
  foundation: 0.4628,
  investment: 0.29,
  burden: 0.1702,
  leak: 0.0769,
}

/** Family wins only if its over-index ratio (share / base rate) clears this. */
export const FALLBACK_MAX_RATIO = 1.25

/** Minimum answered cards for a classification at all. */
export const MIN_ANSWERED_CARDS = 6

/**
 * Per-session certainty-component population medians.
 * Pinned 2026-06-10 from staging, 85 sessions with ≥6 answered cards:
 * median of per-session avg confidence, hard_to_decide rate, and median
 * deliberation_ms.
 */
export const CERTAINTY_MEDIANS_V1 = {
  avgConfidence: 3.0,
  hardRate: 0.0,
  deliberationMs: 1208.5,
} as const

/**
 * Population spreads (stddev_pop over the same 85 sessions) — the z-score
 * denominators for the certainty composite. hardRate's spread is 0 in the
 * pinned population (nobody flagged hard-to-decide); the classifier guards
 * the degenerate case explicitly.
 */
export const CERTAINTY_SPREADS_V1 = {
  avgConfidence: 0.1934,
  hardRate: 0.0,
  deliberationMs: 477.8,
} as const

/**
 * Per-card deliberation band cutoffs: p33 / p66 of deliberation_ms over all
 * answered cards. Pinned 2026-06-10 from staging, n=793 cards with telemetry.
 */
export const DELIBERATION_BANDS_MS = {
  quickMax: 914,
  consideredMax: 1483,
} as const

/** Quadrant a family over-indexes on (and vice versa). */
export const FAMILY_QUADRANT: Record<ArchetypeFamily, ValueQuadrant> = {
  growth: 'investment',
  security: 'foundation',
  agency: 'burden',
  candor: 'leak',
}

export const QUADRANT_FAMILY: Record<ValueQuadrant, ArchetypeFamily> = {
  investment: 'growth',
  foundation: 'security',
  burden: 'agency',
  leak: 'candor',
}

export const FAMILIES: Record<ArchetypeFamily, Record<CertaintyState, string>> = {
  growth: { certain: 'The Builder', exploring: 'The Scout' },
  security: { certain: 'The Fortress', exploring: 'The Nester' },
  agency: { certain: 'The Negotiator', exploring: 'The Restless' },
  candor: { certain: 'The Editor', exploring: 'The Drifter' },
} as const

/**
 * Deterministic ratio→phrase mapping for receipts. Raw multipliers never
 * appear in copy — the phrase is the only rendering of the over-index ratio.
 *   1.25–1.6  'more than most people'
 *   1.6–2.5   'about twice the typical rate'
 *   >2.5      'several times the typical rate'
 */
export function ratioPhrase(ratio: number): string {
  if (ratio > 2.5) return 'several times the typical rate'
  if (ratio >= 1.6) return 'about twice the typical rate'
  return 'more than most people'
}

/** Family-flavoured payback CTA labels (deterministic; fallback = neutral). */
export const FAMILY_PAYBACK_CTA: Record<ArchetypeFamily, string> = {
  growth: 'On to what you’re building',
  security: 'On to securing the base',
  agency: 'On to taking back the terms',
  candor: 'On to the honest plan',
}

/**
 * Plan-surface frame line, one per cell (8 static variants; the plan surface
 * falls back to no line when the user has no classified session). Pure
 * framing — never changes goal maths, ordering, or computation.
 */
export const FAMILY_FRAME_LINES: Record<ArchetypeFamily, Record<CertaintyState, string>> = {
  growth: {
    certain: 'A Builder plan points everything at what you’re building next.',
    exploring: 'A Scout plan keeps options open while the destination settles.',
  },
  security: {
    certain: 'A Fortress plan secures the base first.',
    exploring: 'A Nester plan protects what matters while the edges firm up.',
  },
  agency: {
    certain: 'A Negotiator plan attacks the worst terms first.',
    exploring: 'A Restless plan starts where change costs you least.',
  },
  candor: {
    certain: 'An Editor plan cuts what you’ve already called waste.',
    exploring: 'A Drifter plan starts by making the easy calls stick.',
  },
}
