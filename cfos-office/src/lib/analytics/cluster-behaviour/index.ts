import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getMerchantAggregates,
  getCategoryAggregates,
  getTransactionDatesForCluster,
  getFirstSeenForCluster,
} from './queries';
import {
  deriveRecurrence,
  deriveTrend,
  deriveTimePattern,
  deriveAmountProfile,
  deriveLifecycle,
} from './compute';
import { composeSummary } from './summary';
import type { ClusterBehaviour, ClusterType } from './types';

const DEFAULT_WINDOW_DAYS = 90;
const MIN_VIABLE_WINDOW_DAYS = 30;

export async function getClusterBehaviour(params: {
  userId: string;
  clusterType: ClusterType;
  clusterId: string;
  windowDays?: number;
  /** Inject a Supabase client (used in tests). Defaults to service-role. */
  supabase?: SupabaseClient;
}): Promise<ClusterBehaviour> {
  const supabase = params.supabase ?? createServiceClient();
  const requestedWindow = params.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Determine actual window from user's data span
  const firstSeenInHistory = await getFirstSeenForCluster(
    supabase,
    params.userId,
    params.clusterType,
    params.clusterId,
  );

  let effectiveWindow = requestedWindow;
  let dataCompleteness = 1;
  if (firstSeenInHistory) {
    const daysAvailable = Math.floor(
      (Date.now() - new Date(firstSeenInHistory).getTime()) / 86_400_000,
    );
    if (daysAvailable < requestedWindow) {
      effectiveWindow = Math.max(MIN_VIABLE_WINDOW_DAYS, daysAvailable);
      dataCompleteness = daysAvailable / requestedWindow;
    }
  }

  // Pull aggregates + raw dates/amounts
  const aggregatesPromise =
    params.clusterType === 'merchant'
      ? getMerchantAggregates(supabase, params.userId, params.clusterId, effectiveWindow)
      : getCategoryAggregates(supabase, params.userId, params.clusterId, effectiveWindow);

  const [aggregates, txDetails] = await Promise.all([
    aggregatesPromise,
    getTransactionDatesForCluster(
      supabase,
      params.userId,
      params.clusterType,
      params.clusterId,
      effectiveWindow,
    ),
  ]);

  const recurrence = deriveRecurrence(txDetails.dates);
  const trend = deriveTrend(aggregates);
  const time_pattern = deriveTimePattern(txDetails.dates);
  const amount_profile = deriveAmountProfile(txDetails.amounts);
  const lifecycle = deriveLifecycle({
    firstSeenInHistory,
    lastSeen: txDetails.dates.length ? txDetails.dates[txDetails.dates.length - 1] : null,
    windowDays: effectiveWindow,
  });

  const base = {
    cluster_type: params.clusterType,
    cluster_id: params.clusterId,
    window_days: effectiveWindow,
    data_completeness: Number(dataCompleteness.toFixed(2)),
    recurrence,
    trend,
    time_pattern,
    amount_profile,
    lifecycle,
  } as Omit<ClusterBehaviour, 'summary'>;

  return { ...base, summary: composeSummary(base) };
}

export type { ClusterBehaviour, ClusterType } from './types';
