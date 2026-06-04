// Decoupled Value Map card selector (≤10 cards).
//
// The value-first Value Map historically ran ONLY on the 2-3 hook candidates
// the First Read teased — one representative txn per hook, 3 cards. Those hooks
// were chosen to be unreadable teasers, not to maximise Layer-2 signal, so the
// resulting profile was too thin for buildUserValueProfile's confidence gate to
// clear most categories. This selector decouples the card SET from the hook
// TEASER: the hooks are seeded first (they were promised to the user), then we
// add the merchants where a sort is most likely to contradict probable intent
// (divergence), fill toward a spend-coverage floor, and prefer spread across
// spend domains so the set isn't 8 grocers.
//
// The hook teaser on the First Read close is unchanged — its output is now an
// INPUT to this selector (the seed), not the whole set.
//
// Everything here windows relative to `dataWindowEnd` (the latest transaction
// date), never Date.now() — the same dormancy-vs-today lesson documented in
// spending-breakdown.ts and compose-first-read.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HookCandidate } from '@/lib/ai/compose-first-read-hooks';
import type { ValueMapTransaction } from './types';
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise';
import { getClusterBehaviour } from '@/lib/analytics/cluster-behaviour';
import { getDataWindowEnd } from '@/lib/analytics/cluster-behaviour/queries';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';

const MAX_CARDS = 10; // hard cap — product decision
const COVERAGE_FLOOR = 0.7; // stop once selected merchants cover ~70% of windowed spend
const MIN_CARD_AMOUNT = 10; // ignore trivial merchants (sub-£10 total in window)
const DIVERGENCE_CANDIDATE_LIMIT = 16; // bound cluster-behaviour fetches (one query each)
const DIVERGENCE_THRESHOLD = 0.15; // below this a candidate is "coverage filler", not a divergence pick
const SPREAD_BONUS = 0.15; // soft multiplier preferring unrepresented domains among near-ties

// Divergence weights — sum to 1.0. Spend share dominates (it's where a sort
// matters most in absolute terms); trend/frequency/per-txn-mean sharpen it
// toward the merchants whose stated value is most likely to fight their shape.
const W_SPEND = 0.4;
const W_TREND = 0.25;
const W_FREQ = 0.15;
const W_MEAN = 0.2;

export type CardSelectionReason = 'hook' | 'divergence' | 'coverage' | 'spread';

export type ValueMapCardSelection = {
  /** ≤ MAX_CARDS, one representative txn per merchant. Hooks first, then by divergence. */
  cards: ValueMapTransaction[];
  /** % (0-100) of windowed spend the selected merchants represent. */
  coveragePct: number;
  /** Which teased hooks made the cut (for continuity copy). Normalised merchant keys. */
  includedHookMerchants: string[];
  /** merchantKey → why it was selected. */
  selectionReason: Record<string, CardSelectionReason>;
};

/** One windowed merchant candidate, pre-joined with its Layer-3 behaviour. */
export type CandidateMerchant = {
  /** Normalised display key (matches cluster_id naming). */
  key: string;
  displayName: string;
  /** Absolute windowed spend (outflow only). */
  spend: number;
  txnCount: number;
  /** Spend-domain bucket for spread (dominant_category_id, or 'uncategorised'). */
  domain: string;
  /** Per-transaction mean (absolute). */
  meanAmount: number;
  /** Layer-3 behaviour for this merchant, or null when unavailable. */
  cluster: ClusterBehaviour | null;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Climbing/volatile trend → 0-1, scaled by slope magnitude and confidence. */
export function trendSalience(c: ClusterBehaviour | null): number {
  if (!c || c.trend.direction == null) return 0;
  const climbing = c.trend.direction === 'climbing' || c.trend.direction === 'volatile';
  if (!climbing) return 0;
  const slope = Math.abs(c.trend.slope_percent_per_month ?? 0);
  return clamp01(slope / 50) * clamp01(c.trend.confidence ?? 0);
}

/** Frequency/regularity → 0-1. A habitual merchant is where a value call bites. */
export function freqSalience(c: ClusterBehaviour | null): number {
  if (!c) return 0;
  const countScore = clamp01(c.transaction_count / 20);
  const reg = clamp01(c.recurrence?.regularity_score ?? 0);
  return Math.max(countScore, reg * 0.8);
}

/**
 * Divergence score: where is a user's sort most likely to contradict probable
 * intent? High spend share + climbing trend + habitual frequency + big per-txn
 * tickets. `meanShare` is the candidate's per-txn mean normalised against the
 * set max (caller supplies it). Reused verbatim by significant-merchant.ts so
 * the why-beat picker and the card selector agree on "significant".
 */
export function computeDivergenceScore(
  spendShare: number,
  cluster: ClusterBehaviour | null,
  meanShare: number,
): number {
  return (
    W_SPEND * clamp01(spendShare) +
    W_TREND * trendSalience(cluster) +
    W_FREQ * freqSalience(cluster) +
    W_MEAN * clamp01(meanShare)
  );
}

/** ISO window start, relative to dataWindowEnd (never today). Exported for testing. */
export function windowSince(dataWindowEnd: string | null, windowDays: number): string {
  const endStr = dataWindowEnd ?? new Date().toISOString().slice(0, 10);
  return new Date(new Date(endStr).getTime() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

type ChooseResult = {
  selectedKeys: string[];
  selectionReason: Record<string, CardSelectionReason>;
  coverageFraction: number;
  includedHookMerchants: string[];
};

/**
 * Pure selection over pre-fetched candidates. Hooks seeded first, then top
 * divergence (with spread tie-break), then spend-ordered coverage filler, all
 * capped at MAX_CARDS and halted once the coverage floor is met. No IO — the
 * unit tests target this directly.
 */
export function chooseCards(
  candidates: CandidateMerchant[],
  hookKeys: string[],
): ChooseResult {
  const empty: ChooseResult = {
    selectedKeys: [],
    selectionReason: {},
    coverageFraction: 0,
    includedHookMerchants: [],
  };
  if (candidates.length === 0) return empty;

  const totalSpend = candidates.reduce((a, c) => a + c.spend, 0);
  if (totalSpend <= 0) return empty;

  const meanMax = candidates.reduce((m, c) => Math.max(m, c.meanAmount), 0);
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const score = new Map<string, number>();
  for (const c of candidates) {
    score.set(
      c.key,
      computeDivergenceScore(c.spend / totalSpend, c.cluster, meanMax > 0 ? c.meanAmount / meanMax : 0),
    );
  }

  const selected: string[] = [];
  const reason: Record<string, CardSelectionReason> = {};
  const domains = new Set<string>();
  const includedHooks: string[] = [];
  let coveredSpend = 0;

  const add = (key: string, why: CardSelectionReason) => {
    selected.push(key);
    reason[key] = why;
    const c = byKey.get(key)!;
    domains.add(c.domain);
    coveredSpend += c.spend;
  };
  const coverage = () => coveredSpend / totalSpend;

  // 1. Seed hooks (promised to the user). Dedup, cap at MAX.
  const seenHook = new Set<string>();
  for (const hk of hookKeys) {
    if (selected.length >= MAX_CARDS) break;
    if (!byKey.has(hk) || seenHook.has(hk)) continue;
    seenHook.add(hk);
    add(hk, 'hook');
    includedHooks.push(hk);
  }

  // 2. Divergence phase — add high-divergence candidates (spread tie-break)
  //    until the coverage floor is met or we hit the cap. Candidates below the
  //    divergence threshold are deferred to the coverage-fill phase.
  const remaining = () => candidates.filter((c) => !reason[c.key]);
  while (selected.length < MAX_CARDS && coverage() < COVERAGE_FLOOR) {
    const pool = remaining().filter((c) => (score.get(c.key) ?? 0) >= DIVERGENCE_THRESHOLD);
    if (pool.length === 0) break;
    // Raw top by divergence vs effective top with spread bonus for an
    // unrepresented domain. When the bonus changes the winner, the pick is
    // attributable to spread; otherwise to divergence.
    const rawTop = [...pool].sort((a, b) => (score.get(b.key) ?? 0) - (score.get(a.key) ?? 0))[0];
    const eff = (c: CandidateMerchant) =>
      (score.get(c.key) ?? 0) * (domains.has(c.domain) ? 1 : 1 + SPREAD_BONUS);
    const effTop = [...pool].sort((a, b) => eff(b) - eff(a))[0];
    const why: CardSelectionReason = effTop.key !== rawTop.key ? 'spread' : 'divergence';
    add(effTop.key, why);
  }

  // 3. Coverage fill — if still under the floor and under the cap, add the
  //    highest-spend remaining merchants (low-salience filler) purely to cover.
  while (selected.length < MAX_CARDS && coverage() < COVERAGE_FLOOR) {
    const pool = remaining().sort((a, b) => b.spend - a.spend);
    if (pool.length === 0) break;
    add(pool[0].key, 'coverage');
  }

  return {
    selectedKeys: selected,
    selectionReason: reason,
    coverageFraction: coverage(),
    includedHookMerchants: includedHooks,
  };
}

/**
 * Decoupled card selection for the value-first Value Map. Reads merchant
 * aggregates + Layer-3 behaviour, applies `chooseCards`, and materialises one
 * representative ValueMapTransaction per selected merchant.
 *
 * Empty / no-spend → returns { cards: [], ... }; the caller falls back to
 * buildRealTransactionsFromHooks (and that falls back to SAMPLE_TRANSACTIONS).
 */
/**
 * Build the windowed merchant candidate set (outflow merchants, rolled by
 * normalised key, joined with Layer-3 behaviour). Shared by the card selector
 * and the why-beat's significant-merchant picker so both agree on the candidate
 * universe and the divergence inputs. Windows off `dataWindowEnd`, never today.
 */
export async function buildCandidateMerchants(
  supabase: SupabaseClient,
  userId: string,
  windowDays = 90,
  dataWindowEnd: string | null = null,
): Promise<CandidateMerchant[]> {
  const windowEnd = dataWindowEnd ?? (await getDataWindowEnd(supabase, userId));
  const since = windowSince(windowEnd, windowDays);

  const { data: aggRows, error } = await supabase
    .from('merchant_aggregates')
    .select('merchant_key, transaction_count, total_amount, mean_amount, dominant_category_id')
    .eq('user_id', userId)
    .gte('month_start', since);
  if (error) {
    console.error('[select-cards] merchant_aggregates query failed:', error);
    return [];
  }

  type Roll = {
    spend: number;
    txnCount: number;
    weightedMeanNumer: number;
    domain: string;
    displayName: string;
  };
  const rolled = new Map<string, Roll>();
  for (const row of (aggRows ?? []) as Array<{
    merchant_key: string;
    transaction_count: number;
    total_amount: number;
    mean_amount: number;
    dominant_category_id: string | null;
  }>) {
    if (!row.merchant_key) continue;
    // Outflow only — positive aggregate totals are income/refunds/transfers-in.
    if (Number(row.total_amount) >= 0) continue;
    const key = normaliseMerchantDescription(row.merchant_key);
    if (!key) continue;
    const spend = Math.abs(Number(row.total_amount));
    const count = Number(row.transaction_count) || 0;
    const existing = rolled.get(key);
    if (existing) {
      existing.spend += spend;
      existing.txnCount += count;
      existing.weightedMeanNumer += Math.abs(Number(row.mean_amount)) * count;
    } else {
      rolled.set(key, {
        spend,
        txnCount: count,
        weightedMeanNumer: Math.abs(Number(row.mean_amount)) * count,
        domain: row.dominant_category_id ?? 'uncategorised',
        displayName: key,
      });
    }
  }

  // Drop trivial merchants, sort by spend, and bound how many get a (one-query)
  // cluster-behaviour fetch.
  const ranked = Array.from(rolled.entries())
    .filter(([, r]) => r.spend >= MIN_CARD_AMOUNT)
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, DIVERGENCE_CANDIDATE_LIMIT);
  if (ranked.length === 0) return [];

  const clusters = await Promise.all(
    ranked.map(([key]) =>
      getClusterBehaviour({
        userId,
        clusterType: 'merchant',
        clusterId: key,
        windowDays,
        supabase,
        dataWindowEnd: windowEnd,
      }).catch((err) => {
        console.error('[select-cards] cluster behaviour failed:', key, err);
        return null;
      }),
    ),
  );

  return ranked.map(([key, r], i) => ({
    key,
    displayName: r.displayName,
    spend: r.spend,
    txnCount: r.txnCount,
    domain: r.domain,
    meanAmount: r.txnCount > 0 ? r.weightedMeanNumer / r.txnCount : 0,
    cluster: clusters[i],
  }));
}

export async function selectValueMapCards(
  supabase: SupabaseClient,
  userId: string,
  hooks: HookCandidate[],
  currency: string,
  windowDays = 90,
  dataWindowEnd: string | null = null,
): Promise<ValueMapCardSelection> {
  const empty: ValueMapCardSelection = {
    cards: [],
    coveragePct: 0,
    includedHookMerchants: [],
    selectionReason: {},
  };

  const windowEnd = dataWindowEnd ?? (await getDataWindowEnd(supabase, userId));
  const since = windowSince(windowEnd, windowDays);
  const endStr = windowEnd ?? new Date().toISOString().slice(0, 10);

  const candidates = await buildCandidateMerchants(supabase, userId, windowDays, windowEnd);
  if (candidates.length === 0) return empty;

  // 3. Choose, seeding the teased hooks (normalised to candidate keys).
  const hookKeys = hooks
    .map((h) => normaliseMerchantDescription(h.cluster_id))
    .filter((k) => k.length > 0);
  const chosen = chooseCards(candidates, hookKeys);
  if (chosen.selectedKeys.length === 0) return empty;

  // 4. Materialise one representative txn per selected merchant.
  const cards = await buildRepresentativeCards(
    supabase,
    userId,
    chosen.selectedKeys,
    candidates,
    hooks,
    currency,
    since,
    endStr,
  );
  if (cards.length === 0) return empty;

  return {
    cards,
    coveragePct: Math.round(chosen.coverageFraction * 100),
    includedHookMerchants: chosen.includedHookMerchants,
    selectionReason: chosen.selectionReason,
  };
}

/**
 * One representative ValueMapTransaction per selected merchant — most recent
 * outflow row, bucketed by the same normalisation used for the candidate keys.
 * Cards are emitted in `selectedKeys` order (hooks first, then divergence).
 */
async function buildRepresentativeCards(
  supabase: SupabaseClient,
  userId: string,
  selectedKeys: string[],
  candidates: CandidateMerchant[],
  hooks: HookCandidate[],
  currency: string,
  since: string,
  endStr: string,
): Promise<ValueMapTransaction[]> {
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, description, amount, date, is_recurring, category_id, currency')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .lt('amount', 0)
    .gte('date', since)
    .lte('date', endStr)
    .order('date', { ascending: false });

  if (!txns || txns.length === 0) return [];

  const buckets = new Map<string, (typeof txns)[number]>();
  for (const t of txns) {
    const key = normaliseMerchantDescription((t.description as string | null) ?? '');
    if (!key) continue;
    // Most recent wins (rows already date-desc); keep the first seen per key.
    if (!buckets.has(key)) buckets.set(key, t);
  }

  const hookByKey = new Map(
    hooks.map((h) => [normaliseMerchantDescription(h.cluster_id), h]),
  );
  const candByKey = new Map(candidates.map((c) => [c.key, c]));

  const cards: ValueMapTransaction[] = [];
  for (const key of selectedKeys) {
    const t = buckets.get(key);
    if (!t) continue;
    const hook = hookByKey.get(key);
    const cand = candByKey.get(key);
    cards.push({
      id: t.id as string,
      merchant: hook?.label ?? cand?.displayName ?? key,
      description: (t.description as string | null) ?? hook?.label ?? key,
      amount: Math.abs(Number(t.amount)),
      currency: (t.currency as string | null) ?? currency,
      transaction_date: t.date as string,
      is_recurring: Boolean(t.is_recurring),
      category_id: (t.category_id as string | null) ?? null,
      granularity: 'intent',
      context: hook?.period_hint,
    });
  }
  return cards;
}
