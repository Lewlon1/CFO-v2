// Per-user, per-category quadrant distribution of Value Map classifications.
// Feeds the values_alignment scoring dimension in lib/experiments/scoring.ts.
//
// Data sources, weighted:
//   - value_category_rules (weight 2x) — user-confirmed/learned rules.
//     'category_default' rows are excluded; those are system seeds, not user signal.
//   - transactions.value_category (weight 1x) — only rows where the user has
//     explicitly confirmed, to avoid feeding low-confidence AI suggestions
//     back into the signal.
//
// Categories with fewer than MIN_SIGNAL_FOR_CONFIDENCE total weighted signals
// fall through (absent from the resulting map) → resolveValuesAlignment()
// treats them as neutral 0.5.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ValueQuadrant } from '@/lib/experiments/templates';

export interface UserValueProfile {
  /** category_slug → quadrant shares in [0,1]. Each entry sums to 1.0. */
  by_category: Record<string, Record<ValueQuadrant, number>>;
  /** Total weighted signal count per category (used for confidence gating). */
  signal_count: Record<string, number>;
  /** True when the user has at least one non-deleted value_map_session. */
  has_value_map: boolean;
  /** True when the user has any leak signal across any category. */
  has_any_leak_signal: boolean;
}

export const MIN_SIGNAL_FOR_CONFIDENCE = 3;
const RULE_WEIGHT = 2;
const TRANSACTION_WEIGHT = 1;
const RULE_SOURCES_INCLUDED = ['value_map', 'correction', 'learned'] as const;
const RULE_MATCH_TYPES_INCLUDED = ['category', 'category_time', 'category_amount'] as const;

// Local neutral constant. Mirrors NEUTRAL_VALUES_ALIGNMENT in scoring.ts (also
// 0.5). Kept local to avoid a circular import once scoring.ts depends on this
// module in Phase 4. If scoring.ts changes, update here.
const NEUTRAL_VALUES_ALIGNMENT = 0.5;

const ALIGNMENT_BY_DOMINANT_QUADRANT: Record<ValueQuadrant, number> = {
  foundation: 0.25, // capping fights stated values
  investment: 0.4, // capping investments is risky
  burden: 0.75, // cap aligns — user already resents this spend
  leak: 0.95, // cap aligns perfectly — user labelled it waste
};

const DOMINANT_THRESHOLD = 0.5; // share required to call a quadrant dominant
const LEAK_INTENT_CEILING = 0.85;

export async function buildUserValueProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserValueProfile> {
  const [rulesResult, txResult, sessionResult] = await Promise.all([
    supabase
      .from('value_category_rules')
      .select('match_value, value_category, source, match_type')
      .eq('user_id', userId)
      .in('source', RULE_SOURCES_INCLUDED as unknown as string[])
      .in('match_type', RULE_MATCH_TYPES_INCLUDED as unknown as string[]),
    supabase
      .from('transactions')
      .select('category_id, value_category, value_confirmed_by_user')
      .eq('user_id', userId)
      .not('value_category', 'is', null)
      .not('category_id', 'is', null)
      .eq('value_confirmed_by_user', true),
    supabase
      .from('value_map_sessions')
      .select('id')
      .eq('profile_id', userId)
      .is('deleted_at', null)
      .limit(1),
  ]);

  const has_value_map = (sessionResult.data?.length ?? 0) > 0;

  // Accumulator: category_slug → quadrant → weighted count
  const accum: Record<string, Record<ValueQuadrant, number>> = {};
  const addSignal = (
    category: string | null | undefined,
    quadrant: string | null | undefined,
    weight: number,
  ) => {
    if (!category || !quadrant) return;
    if (
      quadrant !== 'foundation' &&
      quadrant !== 'investment' &&
      quadrant !== 'leak' &&
      quadrant !== 'burden'
    ) {
      return; // skip 'unsure' and anything unexpected
    }
    if (!accum[category]) {
      accum[category] = { foundation: 0, investment: 0, leak: 0, burden: 0 };
    }
    accum[category][quadrant as ValueQuadrant] += weight;
  };

  for (const r of rulesResult.data ?? []) {
    addSignal(r.match_value, r.value_category, RULE_WEIGHT);
  }
  for (const tx of txResult.data ?? []) {
    addSignal(tx.category_id, tx.value_category, TRANSACTION_WEIGHT);
  }

  const by_category: Record<string, Record<ValueQuadrant, number>> = {};
  const signal_count: Record<string, number> = {};
  let has_any_leak_signal = false;

  for (const [category, counts] of Object.entries(accum)) {
    const total = counts.foundation + counts.investment + counts.leak + counts.burden;
    signal_count[category] = total;
    if (counts.leak > 0) has_any_leak_signal = true;
    if (total < MIN_SIGNAL_FOR_CONFIDENCE) continue;
    by_category[category] = {
      foundation: counts.foundation / total,
      investment: counts.investment / total,
      leak: counts.leak / total,
      burden: counts.burden / total,
    };
  }

  return { by_category, signal_count, has_value_map, has_any_leak_signal };
}

/**
 * Score how well an experiment template's category targeting aligns with the
 * user's stated values. Range [0,1], neutral 0.5.
 *
 * Mapping (dominant quadrant where any quadrant share ≥ DOMINANT_THRESHOLD):
 *   foundation → 0.25 (capping fights stated values)
 *   investment → 0.40 (capping investments is risky)
 *   burden     → 0.75 (cap aligns — user resents this spend)
 *   leak       → 0.95 (cap aligns perfectly)
 *   mixed      → 0.50 (no quadrant dominant)
 *
 * Multi-category templates take the MIN across categories (worst case): one
 * Foundation conflict must not be hidden by another category scoring as Leak.
 *
 * quadrant_intent='leak' lifts the floor to LEAK_INTENT_CEILING when the user
 * has any leak signal anywhere — explicit leak-hunting templates should score
 * high for users who have actually identified leaks.
 */
export function resolveValuesAlignment(args: {
  affects_categories?: string[];
  quadrant_intent?: ValueQuadrant;
  /** For 'DYNAMIC' tokens in affects_categories: the resolved real slug. */
  resolved_dynamic_category?: string;
  profile: UserValueProfile;
}): number {
  const { affects_categories, quadrant_intent, resolved_dynamic_category, profile } = args;

  const applyLeakCeiling = (score: number) =>
    quadrant_intent === 'leak' && profile.has_any_leak_signal
      ? Math.max(score, LEAK_INTENT_CEILING)
      : score;

  if (!affects_categories || affects_categories.length === 0) {
    return applyLeakCeiling(NEUTRAL_VALUES_ALIGNMENT);
  }

  const resolved = affects_categories.map((c) =>
    c === 'DYNAMIC' ? (resolved_dynamic_category ?? '') : c,
  );

  const perCategory = resolved.map((category) => {
    if (!category) return NEUTRAL_VALUES_ALIGNMENT;
    const shares = profile.by_category[category];
    if (!shares) return NEUTRAL_VALUES_ALIGNMENT;

    let dominant: ValueQuadrant | null = null;
    let dominantShare = 0;
    for (const q of ['foundation', 'investment', 'leak', 'burden'] as ValueQuadrant[]) {
      if (shares[q] >= DOMINANT_THRESHOLD && shares[q] > dominantShare) {
        dominant = q;
        dominantShare = shares[q];
      }
    }
    if (!dominant) return NEUTRAL_VALUES_ALIGNMENT;
    return ALIGNMENT_BY_DOMINANT_QUADRANT[dominant];
  });

  const worst = Math.min(...perCategory);
  return applyLeakCeiling(worst);
}
