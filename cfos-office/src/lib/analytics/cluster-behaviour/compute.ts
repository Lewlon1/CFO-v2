import type {
  AggregateRow,
  RecurrenceFeature,
  TrendFeature,
  TimePatternFeature,
  AmountProfileFeature,
  LifecycleFeature,
  RecurrencePattern,
  TrendDirection,
  AmountConsistency,
  LifecycleStatus,
} from './types';

// Pure derive functions. Each handles sparse data gracefully (returns null
// values + low confidence rather than throwing). The composer in index.ts
// invokes them with whatever data is available.

const MS_PER_DAY = 86_400_000;

function diffDays(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / MS_PER_DAY);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function scaleConfidenceByN(n: number): number {
  if (n < 3) return 0.2;
  if (n < 5) return 0.4;
  if (n < 10) return 0.6;
  if (n < 20) return 0.85;
  return 1.0;
}

// ----------------------- recurrence -----------------------

export function deriveRecurrence(transactionDates: string[]): RecurrenceFeature {
  const n = transactionDates.length;
  if (n < 3) {
    return {
      median_interval_days: null,
      interval_stddev: null,
      regularity_score: 0,
      pattern_label: 'sparse',
      confidence: scaleConfidenceByN(n),
    };
  }

  const sorted = [...transactionDates].sort();
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(diffDays(sorted[i], sorted[i - 1]));
  }
  const medianGap = median(intervals);
  const sd = stddev(intervals);
  // Regularity: 1 - normalised stddev relative to median; clamp to [0,1]
  const cv = medianGap > 0 ? sd / medianGap : 1;
  const regularity = Math.max(0, Math.min(1, 1 - cv));

  let label: RecurrencePattern;
  const tight = sd < Math.max(medianGap * 0.3, 1.5);
  if (medianGap <= 2 && tight) label = 'daily';
  else if (medianGap >= 5 && medianGap <= 9 && tight) label = 'weekly';
  else if (medianGap >= 25 && medianGap <= 35 && tight) label = 'monthly';
  else label = 'irregular';

  return {
    median_interval_days: Number(medianGap.toFixed(1)),
    interval_stddev: Number(sd.toFixed(2)),
    regularity_score: Number(regularity.toFixed(2)),
    pattern_label: label,
    confidence: scaleConfidenceByN(n),
  };
}

// ----------------------- trend -----------------------

export function deriveTrend(aggregates: AggregateRow[]): TrendFeature {
  const months = aggregates.filter(a => Math.abs(a.total_amount) > 0);
  if (months.length < 3) {
    return {
      slope_amount_per_month: null,
      slope_percent_per_month: null,
      direction: null,
      confidence: months.length === 0 ? 0 : 0.3,
    };
  }

  // Use absolute monthly totals (spending is typically negative; we care about magnitude)
  const ys = months.map(m => Math.abs(m.total_amount));
  const xs = months.map((_, i) => i);

  // Linear regression: slope + R²
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    denX += (xs[i] - meanX) ** 2;
    denY += (ys[i] - meanY) ** 2;
  }
  const slope = denX > 0 ? num / denX : 0;
  const r2 = denX > 0 && denY > 0 ? (num * num) / (denX * denY) : 0;

  const slopePercentPerMonth = meanY > 0 ? (slope / meanY) * 100 : 0;

  // Near-flat data has denY ≈ 0 so R² is undefined. Treat as stable, not volatile.
  // We use 1% of mean as the "flat" threshold.
  const isEffectivelyFlat = meanY > 0 && Math.sqrt(denY / n) / meanY < 0.01;

  let direction: TrendDirection;
  if (isEffectivelyFlat) {
    direction = 'stable';
  } else if (r2 < 0.4) {
    direction = 'volatile';
  } else if (slopePercentPerMonth > 5) {
    direction = 'climbing';
  } else if (slopePercentPerMonth < -5) {
    direction = 'declining';
  } else {
    direction = 'stable';
  }

  const confidence = Math.max(0.3, Math.min(1, n / 6)); // saturates at 6 months

  return {
    slope_amount_per_month: Number(slope.toFixed(2)),
    slope_percent_per_month: Number(slopePercentPerMonth.toFixed(1)),
    direction,
    confidence: Number(confidence.toFixed(2)),
  };
}

// ----------------------- time pattern -----------------------

export function deriveTimePattern(transactionDates: string[]): TimePatternFeature {
  const n = transactionDates.length;
  if (n === 0) {
    return {
      weekday_share: 0,
      day_of_week_distribution: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      dominant_day: null,
      has_weekday_skew: false,
      confidence: 0,
    };
  }

  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const d of transactionDates) {
    const dow = new Date(d).getUTCDay(); // 0=Sun..6=Sat
    counts[dow] += 1;
  }
  const distribution: Record<number, number> = {};
  for (const k of Object.keys(counts)) distribution[Number(k)] = counts[Number(k)] / n;

  const weekdayCount = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
  const weekdayShare = weekdayCount / n;

  let dominantDay = 0;
  let maxCount = -1;
  for (let i = 0; i < 7; i++) {
    if (counts[i] > maxCount) {
      maxCount = counts[i];
      dominantDay = i;
    }
  }

  return {
    weekday_share: Number(weekdayShare.toFixed(3)),
    day_of_week_distribution: Object.fromEntries(
      Object.entries(distribution).map(([k, v]) => [k, Number(v.toFixed(3))])
    ) as Record<number, number>,
    dominant_day: maxCount > 0 ? dominantDay : null,
    has_weekday_skew: weekdayShare > 0.85 || weekdayShare < 0.15,
    confidence: scaleConfidenceByN(n),
  };
}

// ----------------------- amount profile -----------------------

export function deriveAmountProfile(amounts: number[]): AmountProfileFeature {
  const n = amounts.length;
  if (n === 0) {
    return {
      mean_amount: 0,
      stddev_amount: 0,
      coefficient_of_variation: 0,
      min_amount: 0,
      max_amount: 0,
      consistency_label: 'wide',
      confidence: 0,
    };
  }

  const mean = amounts.reduce((s, x) => s + x, 0) / n;
  const sd = stddev(amounts);
  const cv = Math.abs(mean) > 0 ? sd / Math.abs(mean) : 0;

  let label: AmountConsistency;
  if (cv < 0.05) label = 'fixed';
  else if (cv < 0.15) label = 'tight';
  else if (cv < 0.4) label = 'variable';
  else label = 'wide';

  return {
    mean_amount: Number(mean.toFixed(2)),
    stddev_amount: Number(sd.toFixed(2)),
    coefficient_of_variation: Number(cv.toFixed(3)),
    min_amount: Math.min(...amounts),
    max_amount: Math.max(...amounts),
    consistency_label: label,
    confidence: scaleConfidenceByN(n),
  };
}

// ----------------------- lifecycle -----------------------

// Threshold after which the user's whole dataset is "stale" enough that we
// can't trust dormancy claims — they could just be unloaded data.
const STALE_DATA_THRESHOLD_DAYS = 14;

export function deriveLifecycle(params: {
  firstSeenInHistory: string | null;
  lastSeen: string | null;
  windowDays: number;
  now?: Date;
  /**
   * Latest transaction date across the user's entire dataset (ISO date).
   * When supplied, dormancy is measured against this reference rather than
   * today — so a merchant isn't flagged dormant just because the user hasn't
   * uploaded recent data. When the gap between today and this reference
   * exceeds STALE_DATA_THRESHOLD_DAYS, the 'dormant' label is suppressed
   * entirely (we have no evidence of dormancy beyond stale data).
   */
  dataWindowEnd?: string | null;
}): LifecycleFeature {
  const now = params.now ?? new Date();
  const nowISO = now.toISOString().slice(0, 10);

  if (!params.firstSeenInHistory || !params.lastSeen) {
    return {
      first_seen: nowISO,
      last_seen: nowISO,
      days_since_last: 0,
      status: 'new',
      appeared_within_window: false,
      confidence: 0,
    };
  }

  const referenceDate = params.dataWindowEnd ?? nowISO;
  const dataStalenessDays = params.dataWindowEnd ? diffDays(nowISO, params.dataWindowEnd) : 0;
  const daysSinceLast = Math.max(0, diffDays(referenceDate, params.lastSeen));
  const firstSeenDaysAgo = diffDays(nowISO, params.firstSeenInHistory);
  const appearedWithinWindow = firstSeenDaysAgo <= params.windowDays;

  let status: LifecycleStatus;
  if (daysSinceLast > 30) {
    status = 'dormant';
  } else if (appearedWithinWindow && firstSeenDaysAgo <= 30) {
    status = 'new';
  } else {
    status = 'active';
  }
  // Note: 'returning' (gap > 30 then new activity) would require gap analysis;
  // we approximate by flagging as 'active' for now. Future enhancement: detect
  // mid-window dormancy gaps from transaction date list.

  // If the dataset itself is stale, we can't claim dormancy: the merchant
  // might still be active — we just haven't loaded the data.
  if (status === 'dormant' && dataStalenessDays > STALE_DATA_THRESHOLD_DAYS) {
    status = 'active';
  }

  return {
    first_seen: params.firstSeenInHistory,
    last_seen: params.lastSeen,
    days_since_last: daysSinceLast,
    status,
    appeared_within_window: appearedWithinWindow,
    confidence: 0.95,
  };
}
