// Per-user, per-category quadrant distribution of Value Map classifications.
// A Layer 2 (Stated Intent) representation — what the user has said about
// their relationship to each category — independent of behavioural data.
//
// Data sources, weighted:
//   - value_category_rules (weight 2x) — user-confirmed/learned rules.
//     'category_default' rows are excluded; those are system seeds, not user signal.
//   - transactions.value_category (weight 1x) — only rows where the user has
//     explicitly confirmed, to avoid feeding low-confidence AI suggestions
//     back into the signal.
//
// Categories with fewer than MIN_SIGNAL_FOR_CONFIDENCE total weighted signals
// fall through (absent from by_category). signal_count still records the raw
// total so callers can decide how to handle low-signal categories.
//
// Merchants get their own dictionaries (by_merchant / signal_count_by_merchant)
// because the value-first real-transactions Value Map writes merchant-level
// rules (`source='value_map_personal'`, `match_type='merchant'`). One rule per
// merchant is the upsert convention, so merchants do not need the
// MIN_SIGNAL_FOR_CONFIDENCE gate — any rule = mapped.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ValueQuadrant } from '@/lib/value-map/types';

export interface UserValueProfile {
  /** category_slug → quadrant shares in [0,1]. Each entry sums to 1.0. */
  by_category: Record<string, Record<ValueQuadrant, number>>;
  /** Total weighted signal count per category (used for confidence gating). */
  signal_count: Record<string, number>;
  /** merchant_key → quadrant shares in [0,1]. Each entry sums to 1.0. Populated whenever a merchant has ≥1 user-confirmed rule. */
  by_merchant: Record<string, Record<ValueQuadrant, number>>;
  /** Total weighted signal count per merchant. Threshold for "mapped" is >0. */
  signal_count_by_merchant: Record<string, number>;
  /** True when the user has at least one non-deleted value_map_session. */
  has_value_map: boolean;
  /** True when the user has any leak signal across any category. */
  has_any_leak_signal: boolean;
}

export const MIN_SIGNAL_FOR_CONFIDENCE = 3;
const RULE_WEIGHT = 2;
const TRANSACTION_WEIGHT = 1;
// 'value_map' — sample-card Value Map; 'value_map_personal' — real-transactions
// Value Map (merchant rules); 'correction' / 'learned' — chat-side overrides.
const RULE_SOURCES_INCLUDED = ['value_map', 'value_map_personal', 'correction', 'learned'] as const;
// Category-level rules surface in by_category; merchant-level rules surface
// in by_merchant. Both are user signal and both must be aggregated.
const RULE_MATCH_TYPES_INCLUDED = ['category', 'category_time', 'category_amount', 'merchant'] as const;

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

  const categoryAccum: Record<string, Record<ValueQuadrant, number>> = {};
  const merchantAccum: Record<string, Record<ValueQuadrant, number>> = {};
  const addSignal = (
    bucket: Record<string, Record<ValueQuadrant, number>>,
    key: string | null | undefined,
    quadrant: string | null | undefined,
    weight: number,
  ) => {
    if (!key || !quadrant) return;
    if (
      quadrant !== 'foundation' &&
      quadrant !== 'investment' &&
      quadrant !== 'leak' &&
      quadrant !== 'burden'
    ) {
      return;
    }
    if (!bucket[key]) {
      bucket[key] = { foundation: 0, investment: 0, leak: 0, burden: 0 };
    }
    bucket[key][quadrant as ValueQuadrant] += weight;
  };

  for (const r of rulesResult.data ?? []) {
    const target = r.match_type === 'merchant' ? merchantAccum : categoryAccum;
    addSignal(target, r.match_value, r.value_category, RULE_WEIGHT);
  }
  for (const tx of txResult.data ?? []) {
    // Confirmed transactions are category-level only — there is no merchant
    // confirmation surface in chat today.
    addSignal(categoryAccum, tx.category_id, tx.value_category, TRANSACTION_WEIGHT);
  }

  const by_category: Record<string, Record<ValueQuadrant, number>> = {};
  const signal_count: Record<string, number> = {};
  const by_merchant: Record<string, Record<ValueQuadrant, number>> = {};
  const signal_count_by_merchant: Record<string, number> = {};
  let has_any_leak_signal = false;

  for (const [category, counts] of Object.entries(categoryAccum)) {
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

  for (const [merchant, counts] of Object.entries(merchantAccum)) {
    const total = counts.foundation + counts.investment + counts.leak + counts.burden;
    if (total === 0) continue;
    signal_count_by_merchant[merchant] = total;
    if (counts.leak > 0) has_any_leak_signal = true;
    by_merchant[merchant] = {
      foundation: counts.foundation / total,
      investment: counts.investment / total,
      leak: counts.leak / total,
      burden: counts.burden / total,
    };
  }

  return { by_category, signal_count, by_merchant, signal_count_by_merchant, has_value_map, has_any_leak_signal };
}
