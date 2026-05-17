// cfos-office/src/lib/ai/tools/find-temporal-signals.ts
//
// Detective tool: find when spend clusters by time. Returns story-shaped
// candidate observations across four dimensions:
//   A. Day-of-week skew (one weekday ≥ min_multiplier × baseline)
//   B. Time-of-day skew (one TimeContext bucket ≥ min_multiplier × average)
//   C. Weekend vs weekday (per-day rate comparison ≥ min_multiplier)
//   D. Holiday clusters (7-day windows with ≥2× baseline spend + ≥3 merchants
//      across ≥4 distinct days)
//
// Mirrors find-money-clusters in shape: stories, not verdicts. The LLM picks
// which (if any) of these to talk through.

import { z } from 'zod';
import type { ToolContext } from './types';
import {
  EXCLUDED_FROM_PL_PG_LIST,
  affectsSpendingBreakdown,
} from '@/lib/analytics/categories';
import {
  normaliseMerchant,
  absExpense,
} from '@/lib/analytics/pattern-detectors';
import { getTimeContext, type TimeContext } from '@/lib/utils/time-context';
import {
  assessDataConfidence,
  type DataConfidence,
} from './helpers/data-confidence';

const SAMPLE_TRANSACTIONS_LIMIT = 3;
const MERCHANT_LIST_LIMIT = 3;

// Holiday cluster thresholds.
const HOLIDAY_WINDOW_DAYS = 7;
const HOLIDAY_SPEND_MULTIPLIER = 2;
const HOLIDAY_MIN_UNIQUE_MERCHANTS = 3;
const HOLIDAY_MIN_DISTINCT_DAYS = 4;
const HOLIDAY_MIN_WINDOW_DAYS = 14;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TIME_CONTEXT_LABELS: Record<TimeContext, string> = {
  weekday_early: 'weekday early morning',
  weekday_midday: 'weekday midday',
  weekday_evening: 'weekday evening',
  weekday_late: 'weekday late night',
  weekend_morning: 'weekend morning',
  weekend_afternoon: 'weekend afternoon',
  weekend_evening: 'weekend evening',
};

const inputSchema = z.object({
  date_from: z.string().describe('Start date YYYY-MM-DD'),
  date_to: z.string().describe('End date YYYY-MM-DD'),
  min_multiplier: z
    .number()
    .min(1)
    .default(1.5)
    .describe('Minimum spend multiplier vs baseline to surface a signal (default 1.5x)'),
});

export type FindTemporalSignalsInput = z.infer<typeof inputSchema>;

export type TemporalPattern =
  | 'day_of_week'
  | 'time_of_day'
  | 'weekend_skew'
  | 'weekday_skew'
  | 'holiday_cluster';

export interface TemporalSignal {
  pattern: TemporalPattern;
  label: string;
  multiplier: number;
  total_in_pattern: number;
  total_baseline: number;
  top_merchants: Array<{ merchant: string; amount: number }>;
  sample_transactions: Array<{
    id: string;
    date: string;
    merchant: string;
    amount: number;
  }>;
  narrative_hint: string;
  data_confidence: DataConfidence;
}

interface DbRow {
  id: string;
  date: string;
  description: string | null;
  amount: number | string;
  category_id: string | null;
}

interface NormalisedRow {
  id: string;
  date: string;            // raw timestamp/date string from DB
  parsedDate: Date;        // parsed Date object
  description: string;
  merchantKey: string;
  amount: number;          // signed
  absAmount: number;       // absolute spend (refunds → 0 via absExpense)
  category_id: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundMultiplier(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(date_from: string, date_to: string): number {
  const from = new Date(date_from);
  const to = new Date(date_to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return 0;
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1);
}

// Count how many times each weekday (0=Sun..6=Sat) appears in [from, to] inclusive.
function countWeekdayOccurrences(date_from: string, date_to: string): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const from = new Date(date_from);
  const to = new Date(date_to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return counts;
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Walk inclusively day by day.
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    counts[new Date(t).getDay()] += 1;
  }
  return counts;
}

// Pick up to `limit` representative rows: largest absolute spend first.
function pickSampleTransactions(rows: NormalisedRow[], limit: number) {
  return rows
    .slice()
    .sort((a, b) => b.absAmount - a.absAmount)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      date: r.date,
      merchant: r.description,
      amount: round2(r.amount),
    }));
}

// Pick top-N merchant entries (merchant + amount) by spend share inside a row set.
function pickTopMerchants(
  rows: NormalisedRow[],
  limit: number,
): Array<{ merchant: string; amount: number }> {
  const totals = new Map<string, { merchant: string; total: number }>();
  for (const r of rows) {
    const existing = totals.get(r.merchantKey);
    if (existing) {
      existing.total += r.absAmount;
    } else {
      totals.set(r.merchantKey, { merchant: r.merchantKey, total: r.absAmount });
    }
  }
  return Array.from(totals.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((g) => ({ merchant: g.merchant, amount: round2(g.total) }));
}

// --- A. Day-of-week clustering ---
function detectDayOfWeek(
  rows: NormalisedRow[],
  weekdayCounts: number[],
  minMultiplier: number,
  overallConfidence: DataConfidence,
): TemporalSignal[] {
  // Total spend per weekday.
  const totalsByDay: number[] = [0, 0, 0, 0, 0, 0, 0];
  const rowsByDay: NormalisedRow[][] = [[], [], [], [], [], [], []];
  for (const r of rows) {
    const day = r.parsedDate.getDay();
    totalsByDay[day] += r.absAmount;
    rowsByDay[day].push(r);
  }

  // Per-occurrence average per weekday — only defined where the weekday
  // appears at least once in the window.
  const perOccurrence: Array<{ day: number; avg: number }> = [];
  let totalAllSpend = 0;
  let totalDays = 0;
  for (let d = 0; d < 7; d++) {
    const occurrences = weekdayCounts[d];
    if (occurrences > 0) {
      perOccurrence.push({ day: d, avg: totalsByDay[d] / occurrences });
      totalAllSpend += totalsByDay[d];
      totalDays += occurrences;
    }
  }
  if (totalDays === 0 || perOccurrence.length === 0) return [];

  const overallDailyAvg = totalAllSpend / totalDays;
  if (overallDailyAvg <= 0) return [];

  // Find the highest-scoring weekday.
  let top = perOccurrence[0];
  for (const entry of perOccurrence) {
    if (entry.avg > top.avg) top = entry;
  }
  // Require ≥2 occurrences of that day — one Friday is not a pattern.
  if (weekdayCounts[top.day] < 2) return [];

  const multiplier = top.avg / overallDailyAvg;
  if (multiplier < minMultiplier) return [];

  const dayRows = rowsByDay[top.day];
  if (dayRows.length === 0) return [];

  return [
    {
      pattern: 'day_of_week',
      label: `${DAY_NAMES[top.day]} spending`,
      multiplier: roundMultiplier(multiplier),
      total_in_pattern: round2(totalsByDay[top.day]),
      total_baseline: round2(overallDailyAvg * weekdayCounts[top.day]),
      top_merchants: pickTopMerchants(dayRows, MERCHANT_LIST_LIMIT),
      sample_transactions: pickSampleTransactions(dayRows, SAMPLE_TRANSACTIONS_LIMIT),
      narrative_hint:
        'Concentrated on one day of the week — worth asking if that\'s pattern or coincidence.',
      data_confidence: overallConfidence,
    },
  ];
}

// --- B. Time-of-day clustering ---
function detectTimeOfDay(
  rows: NormalisedRow[],
  hasRealTimes: boolean,
  minMultiplier: number,
  overallConfidence: DataConfidence,
): TemporalSignal[] {
  if (!hasRealTimes) return [];

  const buckets: Record<TimeContext, NormalisedRow[]> = {
    weekday_early: [],
    weekday_midday: [],
    weekday_evening: [],
    weekday_late: [],
    weekend_morning: [],
    weekend_afternoon: [],
    weekend_evening: [],
  };
  for (const r of rows) {
    const ctxBucket = getTimeContext(r.parsedDate);
    buckets[ctxBucket].push(r);
  }

  const totals = Object.entries(buckets).map(([bucket, bucketRows]) => ({
    bucket: bucket as TimeContext,
    total: bucketRows.reduce((sum, r) => sum + r.absAmount, 0),
    rows: bucketRows,
  }));

  // Only consider buckets that have spend.
  const nonZero = totals.filter((b) => b.total > 0);
  if (nonZero.length < 2) return [];

  const avgBucket = nonZero.reduce((s, b) => s + b.total, 0) / nonZero.length;
  if (avgBucket <= 0) return [];

  // Highest-spend bucket.
  let top = nonZero[0];
  for (const b of nonZero) {
    if (b.total > top.total) top = b;
  }

  const multiplier = top.total / avgBucket;
  if (multiplier < minMultiplier) return [];

  return [
    {
      pattern: 'time_of_day',
      label: `${TIME_CONTEXT_LABELS[top.bucket]} spending`,
      multiplier: roundMultiplier(multiplier),
      total_in_pattern: round2(top.total),
      total_baseline: round2(avgBucket),
      top_merchants: pickTopMerchants(top.rows, MERCHANT_LIST_LIMIT),
      sample_transactions: pickSampleTransactions(top.rows, SAMPLE_TRANSACTIONS_LIMIT),
      narrative_hint:
        'Heavier in one part of the day — likely tells you something about the context, not just the spend.',
      data_confidence: overallConfidence,
    },
  ];
}

// --- C. Weekend vs weekday ---
function detectWeekendSkew(
  rows: NormalisedRow[],
  weekdayCounts: number[],
  minMultiplier: number,
  overallConfidence: DataConfidence,
): TemporalSignal[] {
  let weekendTotal = 0;
  let weekdayTotal = 0;
  const weekendRows: NormalisedRow[] = [];
  const weekdayRows: NormalisedRow[] = [];
  for (const r of rows) {
    const day = r.parsedDate.getDay();
    if (day === 0 || day === 6) {
      weekendTotal += r.absAmount;
      weekendRows.push(r);
    } else {
      weekdayTotal += r.absAmount;
      weekdayRows.push(r);
    }
  }

  // Count actual days in window per category — handles partial weeks correctly.
  const weekendDays = weekdayCounts[0] + weekdayCounts[6];
  const weekdayDays =
    weekdayCounts[1] + weekdayCounts[2] + weekdayCounts[3] + weekdayCounts[4] + weekdayCounts[5];

  if (weekendDays === 0 || weekdayDays === 0) return [];

  const weekendRate = weekendTotal / weekendDays;
  const weekdayRate = weekdayTotal / weekdayDays;
  if (weekendRate <= 0 && weekdayRate <= 0) return [];

  // If either is zero, multiplier blows up — treat as no signal rather than infinity.
  if (weekendRate === 0 || weekdayRate === 0) return [];

  const weekendMultiplier = weekendRate / weekdayRate;
  const weekdayMultiplier = weekdayRate / weekendRate;

  if (weekendMultiplier >= minMultiplier) {
    return [
      {
        pattern: 'weekend_skew',
        label: 'Weekend spending heavier than weekdays',
        multiplier: roundMultiplier(weekendMultiplier),
        total_in_pattern: round2(weekendTotal),
        total_baseline: round2(weekdayRate * weekendDays),
        top_merchants: pickTopMerchants(weekendRows, MERCHANT_LIST_LIMIT),
        sample_transactions: pickSampleTransactions(weekendRows, SAMPLE_TRANSACTIONS_LIMIT),
        narrative_hint:
          'Weekend running heavier than weekdays — different mode of spending, or just different opportunity?',
        data_confidence: overallConfidence,
      },
    ];
  }
  if (weekdayMultiplier >= minMultiplier) {
    return [
      {
        pattern: 'weekday_skew',
        label: 'Weekday spending heavier than weekends',
        multiplier: roundMultiplier(weekdayMultiplier),
        total_in_pattern: round2(weekdayTotal),
        total_baseline: round2(weekendRate * weekdayDays),
        top_merchants: pickTopMerchants(weekdayRows, MERCHANT_LIST_LIMIT),
        sample_transactions: pickSampleTransactions(weekdayRows, SAMPLE_TRANSACTIONS_LIMIT),
        narrative_hint:
          'Weekdays running heavier than weekends — different mode of spending, or just different opportunity?',
        data_confidence: overallConfidence,
      },
    ];
  }

  return [];
}

// --- D. Holiday clustering ---
//
// Sliding 7-day window check. A holiday cluster is any 7-day stretch where:
//   - total spend in window ≥ 2 × baseline 7-day spend
//   - ≥3 unique merchants in the window
//   - ≥4 distinct days with spend in the window
//
// Returns at most one signal — the heaviest qualifying window. Multiple
// clusters in a long window collapse to the strongest one for cleanliness.
function detectHolidayCluster(
  rows: NormalisedRow[],
  nDays: number,
  overallConfidence: DataConfidence,
): TemporalSignal[] {
  if (nDays < HOLIDAY_MIN_WINDOW_DAYS) return [];
  if (rows.length === 0) return [];

  const totalSpend = rows.reduce((sum, r) => sum + r.absAmount, 0);
  if (totalSpend <= 0) return [];

  // Baseline: average 7-day spend across the whole window.
  const baseline7Day = (totalSpend / nDays) * HOLIDAY_WINDOW_DAYS;
  if (baseline7Day <= 0) return [];
  const threshold = baseline7Day * HOLIDAY_SPEND_MULTIPLIER;

  // Bucket rows by ISO date (YYYY-MM-DD) using UTC slicing.
  const rowsByDay = new Map<string, NormalisedRow[]>();
  for (const r of rows) {
    const key = r.parsedDate.toISOString().slice(0, 10);
    const existing = rowsByDay.get(key);
    if (existing) existing.push(r);
    else rowsByDay.set(key, [r]);
  }

  // Find min/max date in data.
  const allDates = Array.from(rowsByDay.keys()).sort();
  if (allDates.length === 0) return [];

  // Walk every possible window-start day. Use the data's first day as anchor;
  // step through every day where a window of WINDOW_DAYS fits.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const firstDay = new Date(allDates[0] + 'T00:00:00Z').getTime();
  const lastDay = new Date(allDates[allDates.length - 1] + 'T00:00:00Z').getTime();

  let bestWindow: {
    startTime: number;
    endTime: number;
    total: number;
    merchants: Set<string>;
    distinctDays: number;
    rows: NormalisedRow[];
  } | null = null;

  for (let startT = firstDay; startT <= lastDay; startT += DAY_MS) {
    const endT = startT + (HOLIDAY_WINDOW_DAYS - 1) * DAY_MS;
    let windowTotal = 0;
    const merchants = new Set<string>();
    const distinctDays = new Set<string>();
    const windowRows: NormalisedRow[] = [];
    for (let dT = startT; dT <= endT; dT += DAY_MS) {
      const key = new Date(dT).toISOString().slice(0, 10);
      const dayRows = rowsByDay.get(key);
      if (!dayRows) continue;
      distinctDays.add(key);
      for (const r of dayRows) {
        windowTotal += r.absAmount;
        if (r.merchantKey) merchants.add(r.merchantKey);
        windowRows.push(r);
      }
    }

    if (
      windowTotal >= threshold &&
      merchants.size >= HOLIDAY_MIN_UNIQUE_MERCHANTS &&
      distinctDays.size >= HOLIDAY_MIN_DISTINCT_DAYS &&
      (!bestWindow || windowTotal > bestWindow.total)
    ) {
      bestWindow = {
        startTime: startT,
        endTime: endT,
        total: windowTotal,
        merchants,
        distinctDays: distinctDays.size,
        rows: windowRows,
      };
    }
  }

  if (!bestWindow) return [];

  const multiplier = bestWindow.total / baseline7Day;
  const startStr = new Date(bestWindow.startTime).toISOString().slice(0, 10);
  const endStr = new Date(bestWindow.endTime).toISOString().slice(0, 10);

  return [
    {
      pattern: 'holiday_cluster',
      label: `Concentrated spend window (${startStr} → ${endStr})`,
      multiplier: roundMultiplier(multiplier),
      total_in_pattern: round2(bestWindow.total),
      total_baseline: round2(baseline7Day),
      top_merchants: pickTopMerchants(bestWindow.rows, MERCHANT_LIST_LIMIT),
      sample_transactions: pickSampleTransactions(
        bestWindow.rows,
        SAMPLE_TRANSACTIONS_LIMIT,
      ),
      narrative_hint:
        'Cluster of unusual or heavy spend across several days — likely a trip or holiday window.',
      data_confidence: overallConfidence,
    },
  ];
}

export function createFindTemporalSignalsTool(ctx: ToolContext) {
  return {
    description:
      "Find when spend clusters by day-of-week, time-of-day, weekend-vs-weekday, or holiday window. Use when the user's brief mentions cash flow timing concerns, when find_money_clusters returned a category-level story and you want to see if it has a temporal shape, or when the brief mentions weekends, evenings, or specific days. Returns up to several candidate stories the user might want to talk through.",
    inputSchema,
    execute: async (input: FindTemporalSignalsInput) => {
      try {
        const { date_from, date_to, min_multiplier } = input;
        const n_days = daysBetween(date_from, date_to);

        // PostgREST builder chain — same `any` convention as sibling tools.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = ctx.supabase
          .from('transactions')
          .select('id, date, description, amount, category_id')
          .eq('user_id', ctx.userId)
          .gte('date', date_from)
          .lte('date', date_to)
          .is('deleted_at', null)
          // Spend rows only — drop income/transfers/debt-repay/savings server-side.
          .not('category_id', 'in', EXCLUDED_FROM_PL_PG_LIST);

        const { data: rawRows, error } = (await query) as {
          data: DbRow[] | null;
          error: { message: string } | null;
        };

        if (error) {
          console.error('[tool:find_temporal_signals] DB error:', error);
          return { error: 'Could not fetch transactions. Please try again.' };
        }

        // Belt-and-braces: re-filter on the client to drop anything the server
        // missed (e.g. NULL category_id). Mirrors get-spending-summary.
        const filtered = (rawRows ?? []).filter((r) =>
          affectsSpendingBreakdown(r.category_id),
        );

        // Normalise rows for downstream processing.
        const rows: NormalisedRow[] = [];
        for (const r of filtered) {
          const parsed = new Date(r.date);
          if (!Number.isFinite(parsed.getTime())) continue;
          const signed = Number(r.amount);
          const desc = r.description ?? '';
          const normalised = normaliseMerchant(desc);
          rows.push({
            id: r.id,
            date: r.date,
            parsedDate: parsed,
            description: desc || 'Unknown',
            merchantKey: normalised || 'unknown',
            amount: signed,
            absAmount: absExpense(signed),
            category_id: r.category_id as string,
          });
        }

        const n_transactions = rows.length;
        const overallConfidence = assessDataConfidence({
          n_transactions,
          n_days,
        });

        // Determine whether the data has real time-of-day info. Date-only
        // 'YYYY-MM-DD' strings parse to UTC midnight in JS; a real timestamptz
        // value almost always carries a non-zero UTC time component. Check
        // UTC rather than local so this stays correct regardless of host TZ.
        const hasRealTimes =
          rows.length > 0 &&
          rows.some((r) => {
            const h = r.parsedDate.getUTCHours();
            const m = r.parsedDate.getUTCMinutes();
            const s = r.parsedDate.getUTCSeconds();
            return h !== 0 || m !== 0 || s !== 0;
          });

        const confidenceReason = hasRealTimes
          ? overallConfidence.reason
          : `${overallConfidence.reason} Time-of-day signal skipped — input dates lack time component.`;

        const baseReturn = {
          filter: { date_from, date_to, min_multiplier },
          currency: ctx.currency,
          window: { n_transactions, n_days },
          data_confidence: {
            level: overallConfidence.level,
            reason: confidenceReason,
          },
        };

        if (n_transactions === 0) {
          return { ...baseReturn, signals: [] as TemporalSignal[] };
        }

        const weekdayCounts = countWeekdayOccurrences(date_from, date_to);

        const signals: TemporalSignal[] = [
          ...detectDayOfWeek(rows, weekdayCounts, min_multiplier, overallConfidence.level),
          ...detectTimeOfDay(rows, hasRealTimes, min_multiplier, overallConfidence.level),
          ...detectWeekendSkew(rows, weekdayCounts, min_multiplier, overallConfidence.level),
          ...detectHolidayCluster(rows, n_days, overallConfidence.level),
        ];

        return { ...baseReturn, signals };
      } catch (err) {
        console.error('[tool:find_temporal_signals] unexpected error:', err);
        return {
          error: 'Something went wrong finding temporal signals. Please try again.',
        };
      }
    },
  };
}
