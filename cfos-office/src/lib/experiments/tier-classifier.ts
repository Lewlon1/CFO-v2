// Deterministic tier classifier. Decides which of the three Wow Moment v3
// output paths a user lands in based on the strength of the evidence pool
// and the depth of the data we have.
//
// Tier 1 — Showstopper. Top evidence has wow_score >= 0.7. Author all four
//          beats from the chosen evidence.
// Tier 2 — Reframe. Pool exists but no high-impact evidence; data is deep
//          enough to make a confident "you're in good shape" read.
// Tier 3 — Honest tease. Either no evidence at all OR data depth is thin
//          (< 45 days OR < 80 transactions). Tell the user we don't yet have
//          enough to work with and offer the best partial observation.

import type { DataDepth, Evidence, Tier } from './types'

// Tier-1 threshold dropped from 0.7 → 0.6 in Wave 2. With v3-native
// detectors lifted to firmly clear 0.6 (duplicate 0.95, cash-transfer 0.7-0.85,
// evening-cluster 0.7+, foreign-fee 0.75+, big-ticket 0.65+) and legacy
// detectors capped below 0.6 (see evidence-adapter), the lower threshold
// admits real wow material without re-opening the legacy backdoor.
const TIER_1_THRESHOLD = 0.6
const TIER_2_MIN_DAYS = 45
const TIER_2_MIN_TX = 80

export interface TierClassification {
  tier: Tier
  // The chosen evidence drives the prompt brief. May be null only for
  // Tier 3 when the pool is empty.
  evidence: Evidence | null
  // Up to 3 secondary evidences used by Tier 2's reframe (the "what we DO
  // see" backdrop) and Tier 3's "best partial observation."
  supporting: Evidence[]
}

export function classifyTier(
  pool: Evidence[],
  dataDepth: DataDepth,
): TierClassification {
  // Sort the pool descending by wow_score so the chosen evidence is always
  // the strongest in its tier. Stable sort preserves detector insertion
  // order for ties.
  const ranked = [...pool].sort((a, b) => b.wow_score - a.wow_score)

  if (ranked.length === 0) {
    return { tier: 'tier_3', evidence: null, supporting: [] }
  }

  const top = ranked[0]
  const supporting = ranked.slice(1, 4)

  if (top.wow_score >= TIER_1_THRESHOLD) {
    return { tier: 'tier_1', evidence: top, supporting }
  }

  if (dataDepth.days >= TIER_2_MIN_DAYS && dataDepth.txCount >= TIER_2_MIN_TX) {
    return { tier: 'tier_2', evidence: top, supporting }
  }

  return { tier: 'tier_3', evidence: top, supporting }
}
