// Layer 3 — Behavioural features derived per merchant or category cluster.
// See cfos-office/docs/the-layers.md for the architectural framing.

export type ClusterType = 'merchant' | 'category';

export type ClusterBehaviour = {
  cluster_type: ClusterType;
  cluster_id: string;
  window_days: number;
  /** 0-1, proportion of window covered by data. <1 when user has fewer days than the requested window. */
  data_completeness: number;

  recurrence: RecurrenceFeature;
  trend: TrendFeature;
  time_pattern: TimePatternFeature;
  amount_profile: AmountProfileFeature;
  lifecycle: LifecycleFeature;

  /** One-line natural-language hint composed by summary.ts. Useful when the CFO surveys multiple clusters at once. */
  summary: string;
};

export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'irregular' | 'sparse';

export type RecurrenceFeature = {
  median_interval_days: number | null;
  interval_stddev: number | null;
  /** 0-1, higher = more regular */
  regularity_score: number;
  pattern_label: RecurrencePattern;
  confidence: number;
};

export type TrendDirection = 'climbing' | 'declining' | 'stable' | 'volatile';

export type TrendFeature = {
  slope_amount_per_month: number | null;
  slope_percent_per_month: number | null;
  direction: TrendDirection | null;
  confidence: number;
};

export type TimePatternFeature = {
  /** Proportion of transactions Mon-Fri, 0-1 */
  weekday_share: number;
  /** Normalised histogram 0=Sun..6=Sat, values sum to 1 */
  day_of_week_distribution: Record<number, number>;
  dominant_day: number | null;
  has_weekday_skew: boolean;
  confidence: number;
};

export type AmountConsistency = 'fixed' | 'tight' | 'variable' | 'wide';

export type AmountProfileFeature = {
  mean_amount: number;
  stddev_amount: number;
  /** stddev / |mean|; high CV = variable spend */
  coefficient_of_variation: number;
  min_amount: number;
  max_amount: number;
  consistency_label: AmountConsistency;
  confidence: number;
};

export type LifecycleStatus = 'active' | 'dormant' | 'new' | 'returning';

export type LifecycleFeature = {
  /** ISO date */
  first_seen: string;
  /** ISO date */
  last_seen: string;
  days_since_last: number;
  status: LifecycleStatus;
  /** True if first_seen is within the requested window (i.e. cluster is new in the period) */
  appeared_within_window: boolean;
  confidence: number;
};

/** Shape returned from queries.ts — one row per (cluster, month). */
export type AggregateRow = {
  month_start: string;
  transaction_count: number;
  total_amount: number;
  mean_amount: number;
  stddev_amount: number;
  first_seen: string;
  last_seen: string;
  dow_array: number[];
};
