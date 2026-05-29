/**
 * First Read composition orchestrator.
 *
 * Pulls Layer 2 (Value Profile), Layer 3 (behavioural features for top clusters),
 * and Layer 5 (active goal). Composes a one-shot LLM generation via Bedrock.
 * Returns the composed message plus metadata describing what the composition
 * actually cited — Session C's wow_assessment plumbing reads this metadata.
 *
 * No tool calls during composition: the model writes from the pre-computed
 * context. The behavioural tools are for ongoing chat, not this one-shot.
 */

import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';

import { bedrock, chatModelId } from '@/lib/ai/provider';
import { createServiceClient } from '@/lib/supabase/service';
import { buildUserValueProfile } from '@/lib/value-map/value-profile';
import { getClusterBehaviour } from '@/lib/analytics/cluster-behaviour';
import { getDataWindowEnd } from '@/lib/analytics/cluster-behaviour/queries';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise';
import { deriveLevers, type LeverPackage } from '@/lib/analytics/levers';
import {
  reconcileFixedCosts,
  type ReconciledBill,
} from '@/lib/analytics/reconcile-fixed-costs';
import { formatBenchmarkObservation } from '@/lib/analytics/benchmark/format';
import {
  selectHookCandidates,
  type HookCandidate,
} from '@/lib/ai/compose-first-read-hooks';

import {
  FIRST_READ_SYSTEM_PROMPT,
  FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST,
  buildFirstReadUserPrompt,
  type FirstReadComposeOutput,
  type FirstReadMetadata,
} from './prompts/first-read';

const WINDOW_DAYS = 90;
const TOP_CLUSTER_LIMIT = 10;
const MIN_DATA_COMPLETENESS = 0.3;
const MAX_OUTPUT_TOKENS = 700;

const COMPOSE_MODEL = process.env.BEDROCK_COMPOSE_MODEL || chatModelId;

export type ComposeFirstReadMode = 'default' | 'value_first';

export async function composeFirstRead(params: {
  userId: string;
  supabase?: SupabaseClient;
  mode?: ComposeFirstReadMode;
}): Promise<FirstReadComposeOutput> {
  const supabase = params.supabase ?? createServiceClient();
  const mode = params.mode ?? 'default';

  const [valueProfile, topMerchants, goalRow, transactionCountTotal, dataWindowEnd, leverPackage, financialFacts, benchmarkObservation] = await Promise.all([
    buildUserValueProfile(supabase, params.userId),
    getTopMerchantKeys(supabase, params.userId),
    getActiveGoal(supabase, params.userId),
    getTransactionCount(supabase, params.userId, WINDOW_DAYS),
    getDataWindowEnd(supabase, params.userId),
    deriveLevers({ supabase, userId: params.userId }),
    getFinancialFacts(supabase, params.userId),
    getTopBenchmarkObservation(supabase, params.userId),
  ]);

  // Fetched once, threaded into every cluster lookup. Without this every
  // cluster behaviour call re-queries the same MAX(date), and worse, the
  // dormancy threshold compares against today rather than the user's data
  // window — producing false positives like "supermarket dormant for 42 days"
  // when the user's CSV ended 30 days ago.
  const clusterBehaviours = await Promise.all(
    topMerchants.map((merchantKey) =>
      getClusterBehaviour({
        userId: params.userId,
        clusterType: 'merchant',
        clusterId: merchantKey,
        windowDays: WINDOW_DAYS,
        supabase,
        dataWindowEnd,
      }).catch((err) => {
        console.error('[compose-first-read] cluster behaviour failed:', merchantKey, err);
        return null;
      }),
    ),
  );

  const usableClusters = clusterBehaviours.filter(
    (c): c is ClusterBehaviour => c != null && c.data_completeness >= MIN_DATA_COMPLETENESS,
  );

  const goalSummary = goalRow
    ? [
        goalRow.name,
        goalRow.target_amount != null ? `target ${goalRow.target_amount}` : null,
        goalRow.target_date ? `by ${goalRow.target_date}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const dataAgeDays = dataWindowEnd
    ? Math.max(0, Math.floor((Date.now() - new Date(dataWindowEnd).getTime()) / 86_400_000))
    : null;

  // Value-first mode: pre-compute the hook candidates the Read will end on.
  // The candidates are persisted into conversation.metadata by the caller
  // so the Value Map step can run on the same real flagged transactions.
  const hookCandidates: HookCandidate[] =
    mode === 'value_first' ? selectHookCandidates(usableClusters, valueProfile) : [];

  const userPrompt = buildFirstReadUserPrompt({
    userId: params.userId,
    valueProfile,
    goalSummary,
    topClusterBehaviours: usableClusters,
    transactionCountTotal,
    windowDays: WINDOW_DAYS,
    dataWindowEnd,
    dataAgeDays,
    levers: leverPackage.levers,
    blocker: leverPackage.blocker,
    financialFacts,
    hookCandidates: mode === 'value_first' ? hookCandidates : undefined,
    benchmarkObservation,
  });

  const systemPrompt =
    mode === 'value_first' && hookCandidates.length > 0
      ? FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST
      : FIRST_READ_SYSTEM_PROMPT;

  const result = await generateText({
    model: bedrock(COMPOSE_MODEL),
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.5,
    abortSignal: AbortSignal.timeout(20_000),
  });

  const composedMessage = result.text.trim();

  const metadata = extractCompositionMetadata({
    composedMessage,
    usableClusters,
    goalSummary,
    leverPackage,
    mode,
    hookCandidates,
  });

  return { composedMessage, metadata };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTopMerchantKeys(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('merchant_aggregates')
    .select('merchant_key, transaction_count, last_seen, first_seen')
    .eq('user_id', userId)
    .gte('month_start', since)
    .order('transaction_count', { ascending: false })
    .limit(TOP_CLUSTER_LIMIT * 3);
  if (error) {
    console.error('[compose-first-read] getTopMerchantKeys failed:', error);
    return [];
  }

  const rolled = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ merchant_key: string; transaction_count: number }>) {
    if (!row.merchant_key) continue;
    const key = normaliseMerchantDescription(row.merchant_key);
    rolled.set(key, (rolled.get(key) ?? 0) + row.transaction_count);
  }
  return Array.from(rolled.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_CLUSTER_LIMIT)
    .map(([key]) => key);
}

export type FinancialFacts = {
  net_monthly_income: number | null;
  monthly_rent: number | null;
  total_fixed_costs: number | null;
  free_cash_flow: number | null;
};

async function getFinancialFacts(
  supabase: SupabaseClient,
  userId: string,
): Promise<FinancialFacts> {
  const [profileRes, snapshotRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('net_monthly_income, monthly_rent')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('monthly_snapshots')
      .select('total_fixed_costs')
      .eq('user_id', userId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const income =
    typeof profileRes.data?.net_monthly_income === 'number'
      ? profileRes.data.net_monthly_income
      : null;
  const rent =
    typeof profileRes.data?.monthly_rent === 'number'
      ? profileRes.data.monthly_rent
      : null;
  let totalFixed: number | null =
    typeof snapshotRes.data?.total_fixed_costs === 'number'
      ? snapshotRes.data.total_fixed_costs
      : null;
  // Fallback to a live reconcile when the snapshot has no fixed-cost total.
  // Two scenarios this catches: (1) a fresh user whose first snapshot hasn't
  // been generated yet, and (2) any historical snapshot written before the
  // monthly_snapshots.total_fixed_costs column existed (the Supabase insert
  // silently dropped the field). Without this fallback the Read announces
  // "fixed costs aren't on file" even when reconcile would produce a number.
  if (totalFixed == null) {
    try {
      const { totalFixedCostsMonthly } = await reconcileFixedCosts(supabase, userId);
      totalFixed = totalFixedCostsMonthly ?? null;
    } catch (err) {
      console.error('[compose-first-read] reconcile fallback for fixed costs failed:', err);
      totalFixed = null;
    }
  }
  const freeCashFlow =
    income != null && totalFixed != null
      ? Math.round((income - totalFixed) * 100) / 100
      : null;
  return {
    net_monthly_income: income,
    monthly_rent: rent,
    total_fixed_costs: totalFixed,
    free_cash_flow: freeCashFlow,
  };
}

async function getActiveGoal(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ name: string; target_amount: number | null; target_date: string | null } | null> {
  const { data } = await supabase
    .from('goals')
    .select('name, target_amount, target_date')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data
    ? {
        name: data.name as string,
        target_amount: data.target_amount as number | null,
        target_date: data.target_date as string | null,
      }
    : null;
}

/**
 * Picks the single most-above-band bill verdict and renders it as a safe
 * observational sentence. The Read narrates at most one benchmark line — more
 * dilutes the headline and pushes us closer to "audit" territory. Returns
 * null when no above-band verdict exists (the silent case is the default).
 *
 * Re-runs reconcileFixedCosts to derive verdicts fresh. The verdicts are
 * not persisted anywhere (reconcile is the source of truth), so this is
 * the read path. Cost: one extra round-trip of small queries against
 * user_profiles + user_declared_fixed_costs + recurring_expenses, plus N
 * benchmark_reference lookups (N = number of confirmed bills, typically
 * 3-7). Bearable for a one-shot composition; do not call hot.
 */
async function getTopBenchmarkObservation(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  let reconciled: { items: ReconciledBill[] }
  try {
    reconciled = await reconcileFixedCosts(supabase, userId)
  } catch (err) {
    console.error('[compose-first-read] reconcile for benchmark failed:', err)
    return null
  }

  const above = reconciled.items
    .filter((b) => b.benchmark_verdict?.verdict === 'above' && !b.superseded)
    .map((b) => ({
      bill: b,
      delta: b.monthly_equivalent - (b.benchmark_verdict!.band_high ?? b.monthly_equivalent),
    }))
    .sort((a, b) => b.delta - a.delta)

  const top = above[0]
  if (!top || !top.bill.benchmark_verdict) return null

  return formatBenchmarkObservation({
    label: top.bill.label,
    monthly_amount: top.bill.monthly_equivalent,
    verdict: top.bill.benchmark_verdict,
  })
}

async function getTransactionCount(
  supabase: SupabaseClient,
  userId: string,
  windowDays: number,
): Promise<number> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const { count } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', since);
  return count ?? 0;
}

export function extractCompositionMetadata(args: {
  composedMessage: string;
  usableClusters: ClusterBehaviour[];
  goalSummary: string | null;
  leverPackage?: LeverPackage;
  mode?: ComposeFirstReadMode;
  hookCandidates?: HookCandidate[];
}): FirstReadMetadata {
  const text = args.composedMessage.toLowerCase();

  const layers_used = ['L1', 'L2', 'L3'];
  if (args.goalSummary) layers_used.push('L5');

  const features_cited: string[] = [];
  if (/\b(climb\w*|grew|rising|rose|up\s+\d+%|fall\w*|fell|declin\w*|down\s+\d+%|trend\w*)\b/.test(text)) features_cited.push('trend');
  if (/\b(every\s+\d+|recurring|weekly|monthly|daily|clockwork|regular(ly)?)\b/.test(text)) features_cited.push('recurrence');
  if (/\b(weekday|weekend|morning|evening|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/.test(text)) features_cited.push('time_pattern');
  if (/\b(first\s+(seen|appeared|hit)|new\s+(in|since)|dormant|last\s+(seen|hit))\b/.test(text)) features_cited.push('lifecycle');
  if (/\b(mean\s+[£$€\d]|range\s+[£$€\d]|consistent|varies|fixed)\b/.test(text)) features_cited.push('amount_profile');

  const gap_present =
    /\bcalled\s+\w+\s+(a\s+|an\s+)?(leak|burden|foundation|investment)\b/i.test(args.composedMessage) ||
    (/\bvalue\s+map\b/i.test(args.composedMessage) && /\b(but|however|though|opposite|climb|grew|trend|diverg)/i.test(args.composedMessage));

  const clusters_referenced = args.usableClusters
    .map((c) => normaliseMerchantDescription(c.cluster_id))
    .filter((key) => {
      const probe = key.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
      return probe.length > 2 && args.composedMessage.toLowerCase().includes(probe);
    });

  return {
    layers_used,
    features_cited,
    gap_present,
    clusters_referenced,
    levers_offered: args.leverPackage?.levers.map((l) => l.type) ?? [],
    blocker_field: args.leverPackage?.blocker?.type === 'supply_input' ? args.leverPackage.blocker.field : null,
    mode: args.mode ?? 'default',
    hook_candidates: args.hookCandidates ?? null,
  };
}
