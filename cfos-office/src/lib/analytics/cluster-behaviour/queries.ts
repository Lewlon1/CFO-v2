import type { SupabaseClient } from '@supabase/supabase-js';
import type { AggregateRow, ClusterType } from './types';

// All queries here run with the service-role client. The merchant_aggregates
// materialized view has no RLS, so application-level user_id filtering is
// the only guard — it MUST be applied on every read.

function windowStartISO(windowDays: number): string {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - windowDays);
  return start.toISOString().slice(0, 10);
}

// The CFO will say "Pollo Tropical" but the stored merchant_key is
// "POS PURCHASE POLLO TROPICAL #142". Resolve the hint to actual keys via
// ILIKE substring match. Also doubles as brand-level rollup — variants like
// "POS PURCHASE POLLO TROPICAL #142" and "POS PURCHASE POLLO TROPICAL DRIVE THRU"
// both match "pollo tropical" and aggregate as one behavioural cluster.
//
// Cap at 25 keys — beyond that the hint is too broad and the result would be
// dominated by noise. Sorted by total transaction count to prefer high-signal
// variants when truncated.
export async function resolveMerchantKeys(
  supabase: SupabaseClient,
  userId: string,
  hint: string,
): Promise<string[]> {
  // Escape ILIKE wildcards in the user-provided hint.
  const sanitised = hint.replace(/[\\%_]/g, '\\$&');
  const { data, error } = await supabase
    .from('merchant_aggregates')
    .select('merchant_key, transaction_count')
    .eq('user_id', userId)
    .ilike('merchant_key', `%${sanitised}%`)
    .order('transaction_count', { ascending: false })
    .limit(25);
  if (error) throw error;
  const seen = new Set<string>();
  for (const row of (data ?? []) as Array<{ merchant_key: string }>) {
    if (row.merchant_key) seen.add(row.merchant_key);
  }
  return Array.from(seen);
}

export async function getMerchantAggregates(
  supabase: SupabaseClient,
  userId: string,
  merchantKey: string,
  windowDays: number,
): Promise<AggregateRow[]> {
  const since = windowStartISO(windowDays);

  // Resolve the hint to actual merchant_keys (1+ variants).
  const keys = await resolveMerchantKeys(supabase, userId, merchantKey);
  if (keys.length === 0) return [];

  const { data, error } = await supabase
    .from('merchant_aggregates')
    .select('month_start, transaction_count, total_amount, mean_amount, stddev_amount, first_seen, last_seen, dow_array')
    .eq('user_id', userId)
    .in('merchant_key', keys)
    .gte('month_start', since)
    .order('month_start', { ascending: true });
  if (error) throw error;

  // Roll up variants within the same month_start. When one hint maps to a
  // single merchant_key this is a no-op; when it maps to several (brand-level
  // rollup), the per-month aggregates combine.
  return rollupAggregatesByMonth((data ?? []) as AggregateRow[]);
}

export async function getCategoryAggregates(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  windowDays: number,
): Promise<AggregateRow[]> {
  // Category-level aggregation rolls up across merchants. We rely on the MV's
  // dominant_category_id (mode per merchant-month). For analytical purposes
  // this is acceptable; a merchant whose category drifts will show in whichever
  // category it spends most months in.
  const since = windowStartISO(windowDays);
  const { data, error } = await supabase
    .from('merchant_aggregates')
    .select('month_start, transaction_count, total_amount, mean_amount, stddev_amount, first_seen, last_seen, dow_array')
    .eq('user_id', userId)
    .eq('dominant_category_id', categoryId)
    .gte('month_start', since)
    .order('month_start', { ascending: true });
  if (error) throw error;

  return rollupAggregatesByMonth((data ?? []) as AggregateRow[]);
}

/** Per-transaction dates for the cluster, used by derive functions that need transaction-level granularity. */
export async function getTransactionDatesForCluster(
  supabase: SupabaseClient,
  userId: string,
  clusterType: ClusterType,
  clusterId: string,
  windowDays: number,
): Promise<{ dates: string[]; amounts: number[] }> {
  const since = windowStartISO(windowDays);
  let q = supabase
    .from('transactions')
    .select('date, amount')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', since)
    .order('date', { ascending: true });

  if (clusterType === 'merchant') {
    // For merchants, resolve the hint to the same set of keys the MV used.
    const keys = await resolveMerchantKeys(supabase, userId, clusterId);
    if (keys.length === 0) return { dates: [], amounts: [] };
    q = q.in('description', keys);
  } else {
    q = q.eq('category_id', clusterId);
  }

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{ date: string; amount: number | string }>;
  return {
    dates: rows.map(r => (typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10))),
    amounts: rows.map(r => Number(r.amount)),
  };
}

/** First-seen date for the cluster across the user's history (not the windowed slice). Used by lifecycle.appeared_within_window. */
export async function getFirstSeenForCluster(
  supabase: SupabaseClient,
  userId: string,
  clusterType: ClusterType,
  clusterId: string,
): Promise<string | null> {
  let q = supabase
    .from('transactions')
    .select('date')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('date', { ascending: true })
    .limit(1);

  if (clusterType === 'merchant') {
    const keys = await resolveMerchantKeys(supabase, userId, clusterId);
    if (keys.length === 0) return null;
    q = q.in('description', keys);
  } else {
    q = q.eq('category_id', clusterId);
  }

  const { data, error } = await q;
  if (error) throw error;
  const row = (data ?? [])[0] as { date: string } | undefined;
  if (!row) return null;
  return typeof row.date === 'string' ? row.date.slice(0, 10) : new Date(row.date).toISOString().slice(0, 10);
}

// ---------- internal ----------

function rollupAggregatesByMonth(rows: AggregateRow[]): AggregateRow[] {
  const byMonth = new Map<string, AggregateRow>();
  for (const row of rows) {
    const existing = byMonth.get(row.month_start);
    if (!existing) {
      byMonth.set(row.month_start, { ...row });
    } else {
      const totalCount = existing.transaction_count + row.transaction_count;
      const totalSum = existing.total_amount + row.total_amount;
      existing.transaction_count = totalCount;
      existing.total_amount = totalSum;
      existing.mean_amount = totalCount > 0 ? totalSum / totalCount : 0;
      // Exact stddev across groups requires the original samples; approximate
      // by taking the max so amount_profile.consistency_label leans pessimistic.
      existing.stddev_amount = Math.max(existing.stddev_amount, row.stddev_amount);
      existing.first_seen = existing.first_seen < row.first_seen ? existing.first_seen : row.first_seen;
      existing.last_seen = existing.last_seen > row.last_seen ? existing.last_seen : row.last_seen;
      existing.dow_array = existing.dow_array.concat(row.dow_array);
    }
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month_start.localeCompare(b.month_start));
}
