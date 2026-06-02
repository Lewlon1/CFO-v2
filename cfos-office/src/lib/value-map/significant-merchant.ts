// Pick the single most significant AMBIGUOUS merchant for the why-beat.
//
// After the delta recompose hands off into chat, the CFO's opening move is a
// read-and-confirm about ONE merchant — the one where knowing the "why" actually
// unlocks something. That is not a random merchant and not simply the biggest:
// it's high behavioural salience AND ambiguous, meaning the user's own Value Map
// sort was low-confidence OR their stated quadrant disagrees with the merchant's
// behavioural shape. The reply is captured by the existing Layer-4 chat_signals
// extractor — this module only chooses the subject.
//
// Salience and divergence reuse computeDivergenceScore from select-cards.ts so
// the why-beat picker and the card selector agree on what "significant" means.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ValueQuadrant } from './types';
import {
  buildCandidateMerchants,
  computeDivergenceScore,
  type CandidateMerchant,
} from './select-cards';
import { buildUserValueProfile } from './value-profile';
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise';
import { getDataWindowEnd } from '@/lib/analytics/cluster-behaviour/queries';

export type SignificantMerchant = {
  merchantKey: string;
  displayName: string;
  /** Layer 3: spend + trend + frequency + per-txn mean (0-1). */
  salienceScore: number;
  /** The Value Map sort confidence (1-5), if this merchant was a card; null otherwise. */
  userConfidence: number | null;
  /** Stated quadrant vs behavioural shape disagree. */
  likelyDivergence: boolean;
};

// A merchant is salient enough to be worth understanding only above this floor —
// below it the "why" doesn't unlock much, so the CFO opens on something else.
const MIN_SALIENCE = 0.18;
// 1-5 confidence; at or below this the user was unsure when they sorted it.
const LOW_CONFIDENCE_MAX = 2;

function dominantStatedQuadrant(
  byMerchant: Record<string, Record<ValueQuadrant, number>>,
  key: string,
): ValueQuadrant | null {
  const entry = byMerchant[key] ?? byMerchant[key.toLowerCase()];
  if (!entry) return null;
  const sorted = (Object.entries(entry) as Array<[ValueQuadrant, number]>).sort(
    (a, b) => b[1] - a[1],
  );
  return sorted[0]?.[1] > 0 ? sorted[0][0] : null;
}

/**
 * Stated quadrant vs behavioural shape disagree:
 *   - called Leak/Burden but it's a regular committed habit (looks Foundation),
 *   - called Foundation/Investment but it's climbing fast (looks like a Leak),
 *   - no stated quadrant at all but the behaviour is salient (genuinely unread).
 */
function detectDivergence(
  cand: CandidateMerchant,
  stated: ValueQuadrant | null,
): boolean {
  const c = cand.cluster;
  if (!stated) return true; // unsorted-but-salient is itself ambiguous
  if (!c) return false;
  const climbingFast =
    c.trend.direction === 'climbing' && Math.abs(c.trend.slope_percent_per_month ?? 0) >= 15;
  const habitual = (c.recurrence?.regularity_score ?? 0) >= 0.6 && c.transaction_count >= 6;
  if ((stated === 'leak' || stated === 'burden') && habitual) return true;
  if ((stated === 'foundation' || stated === 'investment') && climbingFast) return true;
  return false;
}

/**
 * Pure ranking over pre-fetched inputs. The "most significant ambiguous"
 * merchant = highest salience among those that are ambiguous (low sort
 * confidence, unsorted, or stated-vs-actual divergence), above MIN_SALIENCE.
 * Unit-tested directly.
 */
export function chooseSignificantMerchant(
  candidates: CandidateMerchant[],
  byMerchant: Record<string, Record<ValueQuadrant, number>>,
  confidenceByKey: Map<string, number>,
): SignificantMerchant | null {
  if (candidates.length === 0) return null;
  const totalSpend = candidates.reduce((a, c) => a + c.spend, 0);
  if (totalSpend <= 0) return null;
  const meanMax = candidates.reduce((m, c) => Math.max(m, c.meanAmount), 0);

  const scored = candidates.map((cand) => {
    const salienceScore = computeDivergenceScore(
      cand.spend / totalSpend,
      cand.cluster,
      meanMax > 0 ? cand.meanAmount / meanMax : 0,
    );
    const stated = dominantStatedQuadrant(byMerchant, cand.key);
    const userConfidence = confidenceByKey.get(cand.key) ?? null;
    const likelyDivergence = detectDivergence(cand, stated);
    const lowConfidence = userConfidence != null && userConfidence <= LOW_CONFIDENCE_MAX;
    const unsorted = userConfidence == null;
    const ambiguous = lowConfidence || unsorted || likelyDivergence;
    return { cand, salienceScore, userConfidence, likelyDivergence, ambiguous };
  });

  const best = scored
    .filter((s) => s.ambiguous && s.salienceScore >= MIN_SALIENCE)
    .sort((a, b) => b.salienceScore - a.salienceScore)[0];
  if (!best) return null;

  return {
    merchantKey: best.cand.key,
    displayName: best.cand.displayName,
    salienceScore: best.salienceScore,
    userConfidence: best.userConfidence,
    likelyDivergence: best.likelyDivergence,
  };
}

export async function pickSignificantAmbiguousMerchant(
  supabase: SupabaseClient,
  userId: string,
): Promise<SignificantMerchant | null> {
  const windowEnd = await getDataWindowEnd(supabase, userId);
  const [candidates, valueProfile, confidenceByKey] = await Promise.all([
    buildCandidateMerchants(supabase, userId, 90, windowEnd),
    buildUserValueProfile(supabase, userId),
    readSortConfidence(supabase, userId),
  ]);
  return chooseSignificantMerchant(candidates, valueProfile.by_merchant, confidenceByKey);
}

/**
 * The user's per-merchant Value Map sort confidence (1-5) from the latest
 * session. Keyed by normalised merchant so it joins to candidate keys.
 */
async function readSortConfidence(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data: session } = await supabase
    .from('value_map_sessions')
    .select('id')
    .eq('profile_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session?.id) return out;

  const { data: rows } = await supabase
    .from('value_map_results')
    .select('merchant, confidence')
    .eq('session_id', session.id);
  for (const r of (rows ?? []) as Array<{ merchant: string | null; confidence: number | null }>) {
    if (!r.merchant) continue;
    const key = normaliseMerchantDescription(r.merchant);
    if (!key) continue;
    // Keep the lowest confidence seen for the merchant (most ambiguous wins).
    const prev = out.get(key);
    const conf = r.confidence ?? 0;
    if (prev == null || conf < prev) out.set(key, conf);
  }
  return out;
}
