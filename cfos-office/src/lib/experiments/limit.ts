// Active-experiment limit + completion-rate + novelty filter.
//
// Formula (locked): max(1, min(3, ceil(rate * 3))) over the last 4 rows whose
// status is one of {succeeded, partial, failed}. expired rows are explicitly
// excluded from the rolling window. New users (0 completed) start at limit=1.

import type { SupabaseClient } from '@supabase/supabase-js';

const WINDOW_SIZE = 4;
const COMPLETION_STATUSES = ['succeeded', 'partial', 'failed'] as const;
const ACTIVE_STATUSES = ['accepted', 'active'] as const;
const NOVELTY_DAYS_DEFAULT = 90;

export type CompletedStatus = (typeof COMPLETION_STATUSES)[number];

export interface CompletionStats {
  window: number;
  succeeded: number;
  partial: number;
  failed: number;
  rate: number; // (succeeded + partial) / window, 0..1
}

export function computeCompletionStats(
  recentOutcomes: readonly CompletedStatus[],
): CompletionStats {
  const window = recentOutcomes.slice(0, WINDOW_SIZE);
  const succeeded = window.filter((s) => s === 'succeeded').length;
  const partial = window.filter((s) => s === 'partial').length;
  const failed = window.filter((s) => s === 'failed').length;
  const rate = window.length === 0 ? 0 : (succeeded + partial) / window.length;
  return { window: window.length, succeeded, partial, failed, rate };
}

export function computeActiveLimit(stats: CompletionStats): number {
  if (stats.window === 0) return 1;
  return Math.max(1, Math.min(3, Math.ceil(stats.rate * 3)));
}

export async function fetchRecentCompletionStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<CompletionStats> {
  const { data, error } = await supabase
    .from('proposed_experiments')
    .select('status, outcome_reported_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .in('status', COMPLETION_STATUSES as unknown as string[])
    .order('outcome_reported_at', { ascending: false })
    .limit(WINDOW_SIZE);

  if (error) {
    console.error('[experiments] fetchRecentCompletionStats error:', error);
    return computeCompletionStats([]);
  }

  const statuses = (data ?? [])
    .map((row) => row.status as CompletedStatus)
    .filter((s): s is CompletedStatus => COMPLETION_STATUSES.includes(s));

  return computeCompletionStats(statuses);
}

export async function countActiveExperiments(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('proposed_experiments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .in('status', ACTIVE_STATUSES as unknown as string[]);

  if (error) {
    console.error('[experiments] countActiveExperiments error:', error);
    return 0;
  }
  return count ?? 0;
}

export interface CapacityCheck {
  allowed: boolean;
  activeCount: number;
  limit: number;
}

export async function isCapacityAvailable(
  supabase: SupabaseClient,
  userId: string,
): Promise<CapacityCheck> {
  const [stats, activeCount] = await Promise.all([
    fetchRecentCompletionStats(supabase, userId),
    countActiveExperiments(supabase, userId),
  ]);
  const limit = computeActiveLimit(stats);
  return { allowed: activeCount < limit, activeCount, limit };
}

export async function recentlyProposedTemplateIds(
  supabase: SupabaseClient,
  userId: string,
  days = NOVELTY_DAYS_DEFAULT,
): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('proposed_experiments')
    .select('template_id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .not('template_id', 'is', null)
    .gte('proposed_at', since);

  if (error) {
    console.error('[experiments] recentlyProposedTemplateIds error:', error);
    return new Set();
  }

  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (typeof row.template_id === 'string') ids.add(row.template_id);
  }
  return ids;
}
