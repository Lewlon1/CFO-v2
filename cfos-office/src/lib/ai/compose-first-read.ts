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

import {
  FIRST_READ_SYSTEM_PROMPT,
  buildFirstReadUserPrompt,
  type FirstReadComposeOutput,
  type FirstReadMetadata,
} from './prompts/first-read';

const WINDOW_DAYS = 90;
const TOP_CLUSTER_LIMIT = 10;
const MIN_DATA_COMPLETENESS = 0.3;
const MAX_OUTPUT_TOKENS = 700;

const COMPOSE_MODEL = process.env.BEDROCK_COMPOSE_MODEL || chatModelId;

export async function composeFirstRead(params: {
  userId: string;
  supabase?: SupabaseClient;
}): Promise<FirstReadComposeOutput> {
  const supabase = params.supabase ?? createServiceClient();

  const [valueProfile, topMerchants, goalRow, transactionCountTotal, dataWindowEnd] = await Promise.all([
    buildUserValueProfile(supabase, params.userId),
    getTopMerchantKeys(supabase, params.userId),
    getActiveGoal(supabase, params.userId),
    getTransactionCount(supabase, params.userId, WINDOW_DAYS),
    getDataWindowEnd(supabase, params.userId),
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

  const userPrompt = buildFirstReadUserPrompt({
    userId: params.userId,
    valueProfile,
    goalSummary,
    topClusterBehaviours: usableClusters,
    transactionCountTotal,
    windowDays: WINDOW_DAYS,
    dataWindowEnd,
    dataAgeDays,
  });

  const result = await generateText({
    model: bedrock(COMPOSE_MODEL),
    system: FIRST_READ_SYSTEM_PROMPT,
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

  return { layers_used, features_cited, gap_present, clusters_referenced };
}
