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

export async function getMerchantAggregates(
  supabase: SupabaseClient,
  userId: string,
  merchantKey: string,
  windowDays: number,
): Promise<AggregateRow[]> {
  const since = windowStartISO(windowDays);
  const { data, error } = await supabase
    .from('merchant_aggregates')
    .select('month_start, transaction_count, total_amount, mean_amount, stddev_amount, first_seen, last_seen, dow_array')
    .eq('user_id', userId)
    .eq('merchant_key', merchantKey)
    .gte('month_start', since)
    .order('month_start', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AggregateRow[];
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

  // Roll up multiple merchants within the same month_start into a single row.
  const byMonth = new Map<string, AggregateRow>();
  for (const row of (data ?? []) as AggregateRow[]) {
    const existing = byMonth.get(row.month_start);
    if (!existing) {
      byMonth.set(row.month_start, { ...row });
    } else {
      const totalCount = existing.transaction_count + row.transaction_count;
      const totalSum = existing.total_amount + row.total_amount;
      existing.transaction_count = totalCount;
      existing.total_amount = totalSum;
      existing.mean_amount = totalCount > 0 ? totalSum / totalCount : 0;
      existing.stddev_amount = Math.max(existing.stddev_amount, row.stddev_amount); // approximation; exact stddev across groups is harder
      existing.first_seen = existing.first_seen < row.first_seen ? existing.first_seen : row.first_seen;
      existing.last_seen = existing.last_seen > row.last_seen ? existing.last_seen : row.last_seen;
      existing.dow_array = existing.dow_array.concat(row.dow_array);
    }
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month_start.localeCompare(b.month_start));
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
    q = q.eq('description', clusterId);
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
  if (clusterType === 'merchant') q = q.eq('description', clusterId);
  else q = q.eq('category_id', clusterId);
  const { data, error } = await q;
  if (error) throw error;
  const row = (data ?? [])[0] as { date: string } | undefined;
  if (!row) return null;
  return typeof row.date === 'string' ? row.date.slice(0, 10) : new Date(row.date).toISOString().slice(0, 10);
}
