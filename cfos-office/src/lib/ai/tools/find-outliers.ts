// cfos-office/src/lib/ai/tools/find-outliers.ts
//
// Detective tool: surface individual transactions or category-level patterns
// that are unusual relative to the user's OWN baseline. Three outlier types:
//   A. Large one-off transaction (≥3× median baseline txn amount, not recurring)
//   B. First-time merchant (new in window, ≥5% of window spend)
//   C. Sudden category swing (per-day rate jumped ≥3× baseline)
//
// Mirrors sibling detective tools in shape: stories with one-line
// `why_unusual` strings, no value vocabulary. The LLM picks which (if any)
// to talk through.

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
import {
  assessDataConfidence,
  type DataConfidence,
} from './helpers/data-confidence';

// Detector thresholds — kept as named constants so future tuning is one place.
const LARGE_ONE_OFF_MULTIPLIER = 3;             // ≥3× median baseline txn amount
const LARGE_ONE_OFF_MIN_BASELINE_TXNS = 10;     // skip type if baseline < 10 txns
const RECURRING_AMOUNT_TOLERANCE = 0.20;        // ±20% match window
const RECURRING_MIN_OCCURRENCES = 2;            // ≥2 baseline txns at similar amount

const FIRST_TIME_MIN_SHARE = 0.05;              // ≥5% of window spend
const NEW_MERCHANT_MIN_BASELINE_DAYS = 30;      // skip type if baseline < 30 days
const NEW_MERCHANT_MIN_BASELINE_TXNS = 20;      // skip type if baseline < 20 txns

const CATEGORY_SWING_MULTIPLIER = 3;            // ≥3× per-day baseline rate
const CATEGORY_SWING_MIN_AMOUNT = 50;           // window category spend ≥ 50 currency

const SAMPLE_TRANSACTIONS_LIMIT = 3;
const DRIVING_MERCHANT_LIMIT = 3;

const inputSchema = z.object({
  date_from: z.string().describe('Window start YYYY-MM-DD'),
  date_to: z.string().describe('Window end YYYY-MM-DD'),
  baseline_lookback_days: z
    .number()
    .int()
    .min(30)
    .max(365)
    .default(90)
    .describe(
      'How far back to compute baselines (default 90 days). Window data is excluded from baseline.',
    ),
});

export type FindOutliersInput = z.infer<typeof inputSchema>;

export type OutlierType =
  | 'large_one_off'
  | 'first_time_merchant'
  | 'category_swing';

interface LargeOneOffOutlier {
  type: 'large_one_off';
  transaction: {
    id: string;
    date: string;
    merchant: string;
    amount: number;
    category: string | null;
  };
  context: {
    median_amount: number;
    multiplier: number;
  };
  why_unusual: string;
}

interface FirstTimeMerchantOutlier {
  type: 'first_time_merchant';
  merchant: string;
  context: {
    window_spend: number;
    window_transaction_count: number;
    share_of_window_pct: number;
    sample_transactions: Array<{ id: string; date: string; amount: number }>;
  };
  why_unusual: string;
}

interface CategorySwingOutlier {
  type: 'category_swing';
  category: string;
  context: {
    window_spend: number;
    window_per_day: number;
    baseline_per_day: number;
    multiplier: number;
    driving_merchants: Array<{ merchant: string; amount: number }>;
  };
  why_unusual: string;
}

export type Outlier =
  | LargeOneOffOutlier
  | FirstTimeMerchantOutlier
  | CategorySwingOutlier;

interface DbRow {
  id: string;
  date: string;
  description: string | null;
  amount: number | string;
  category_id: string | null;
}

interface NormalisedRow {
  id: string;
  date: string;            // raw string from DB (YYYY-MM-DD slice used for matching)
  description: string;     // user-facing display (description or 'Unknown')
  merchantKey: string;     // normalised key for matching/grouping
  amount: number;          // signed
  absAmount: number;       // absolute spend (refunds → 0)
  category_id: string;     // non-null post filter
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundMultiplier(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

function daysBetween(date_from: string, date_to: string): number {
  const from = new Date(date_from);
  const to = new Date(date_to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return 0;
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Inclusive day count: from 2026-04-01 to 2026-04-30 = 30 days.
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1);
}

// Median of a numeric array. Returns 0 for empty input.
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// Subtract N days from a YYYY-MM-DD date string and return the same shape.
function subtractDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO);
  if (!Number.isFinite(d.getTime())) return dateISO;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return new Date(d.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

// --- A. Large one-off transaction ---
function detectLargeOneOffs(
  windowRows: NormalisedRow[],
  baselineRows: NormalisedRow[],
): LargeOneOffOutlier[] {
  if (baselineRows.length < LARGE_ONE_OFF_MIN_BASELINE_TXNS) return [];

  // Median of absolute baseline txn amounts (drop zero-spend / refund-only).
  const baselineAmounts = baselineRows.map((r) => r.absAmount).filter((a) => a > 0);
  if (baselineAmounts.length < LARGE_ONE_OFF_MIN_BASELINE_TXNS) return [];
  const baselineMedian = median(baselineAmounts);
  if (baselineMedian <= 0) return [];

  const threshold = baselineMedian * LARGE_ONE_OFF_MULTIPLIER;

  // Group baseline rows by merchant for the "is it recurring?" check.
  const baselineByMerchant = new Map<string, number[]>();
  for (const r of baselineRows) {
    if (r.absAmount <= 0) continue;
    const existing = baselineByMerchant.get(r.merchantKey);
    if (existing) existing.push(r.absAmount);
    else baselineByMerchant.set(r.merchantKey, [r.absAmount]);
  }

  const outliers: LargeOneOffOutlier[] = [];
  for (const row of windowRows) {
    if (row.absAmount < threshold) continue;

    // "Not part of a recurring pattern" — exclude when the same merchant has
    // ≥2 baseline transactions within ±20% of this row's amount.
    const baselineAmountsForMerchant = baselineByMerchant.get(row.merchantKey) ?? [];
    const lower = row.absAmount * (1 - RECURRING_AMOUNT_TOLERANCE);
    const upper = row.absAmount * (1 + RECURRING_AMOUNT_TOLERANCE);
    const similarCount = baselineAmountsForMerchant.filter(
      (a) => a >= lower && a <= upper,
    ).length;
    if (similarCount >= RECURRING_MIN_OCCURRENCES) continue;

    const multiplier = row.absAmount / baselineMedian;

    outliers.push({
      type: 'large_one_off',
      transaction: {
        id: row.id,
        date: row.date,
        merchant: row.description,
        amount: round2(row.amount),
        category: row.category_id,
      },
      context: {
        median_amount: round2(baselineMedian),
        multiplier: roundMultiplier(multiplier),
      },
      why_unusual: `This one transaction is ${roundMultiplier(multiplier)}× your typical purchase size in the last ${baselineRows.length > 0 ? '90' : '0'} days.`,
    });
  }

  // Sort by multiplier desc — biggest anomaly first.
  outliers.sort((a, b) => b.context.multiplier - a.context.multiplier);
  return outliers;
}

// --- B. First-time merchant ---
function detectFirstTimeMerchants(
  windowRows: NormalisedRow[],
  baselineRows: NormalisedRow[],
  baselineLookbackDays: number,
  windowTotalSpend: number,
): FirstTimeMerchantOutlier[] {
  if (baselineLookbackDays < NEW_MERCHANT_MIN_BASELINE_DAYS) return [];
  if (baselineRows.length < NEW_MERCHANT_MIN_BASELINE_TXNS) return [];
  if (windowTotalSpend <= 0) return [];

  // Set of merchant keys present in baseline.
  const baselineMerchants = new Set<string>();
  for (const r of baselineRows) {
    if (r.merchantKey) baselineMerchants.add(r.merchantKey);
  }

  // Group window rows by merchant — only those NOT seen in baseline.
  const newMerchantRows = new Map<string, NormalisedRow[]>();
  for (const r of windowRows) {
    if (!r.merchantKey) continue;
    if (baselineMerchants.has(r.merchantKey)) continue;
    const existing = newMerchantRows.get(r.merchantKey);
    if (existing) existing.push(r);
    else newMerchantRows.set(r.merchantKey, [r]);
  }

  const outliers: FirstTimeMerchantOutlier[] = [];
  for (const [merchant, rows] of newMerchantRows.entries()) {
    const total = rows.reduce((s, r) => s + r.absAmount, 0);
    const share = total / windowTotalSpend;
    if (share < FIRST_TIME_MIN_SHARE) continue;

    // Up to 3 sample transactions, largest first.
    const sample_transactions = rows
      .slice()
      .sort((a, b) => b.absAmount - a.absAmount)
      .slice(0, SAMPLE_TRANSACTIONS_LIMIT)
      .map((r) => ({ id: r.id, date: r.date, amount: round2(r.amount) }));

    const sharePct = roundPct(share * 100);

    outliers.push({
      type: 'first_time_merchant',
      merchant,
      context: {
        window_spend: round2(total),
        window_transaction_count: rows.length,
        share_of_window_pct: sharePct,
        sample_transactions,
      },
      why_unusual: `New merchant this period — ${round2(total)} across ${rows.length} ${rows.length === 1 ? 'visit' : 'visits'}, ${sharePct}% of your window spend.`,
    });
  }

  outliers.sort((a, b) => b.context.window_spend - a.context.window_spend);
  return outliers;
}

// --- C. Sudden category swing ---
function detectCategorySwings(
  windowRows: NormalisedRow[],
  baselineRows: NormalisedRow[],
  windowDays: number,
  baselineDays: number,
): CategorySwingOutlier[] {
  if (baselineDays < NEW_MERCHANT_MIN_BASELINE_DAYS) return [];
  if (baselineRows.length < NEW_MERCHANT_MIN_BASELINE_TXNS) return [];
  if (windowDays <= 0 || baselineDays <= 0) return [];

  // Group both windows by category.
  const windowByCategory = new Map<string, NormalisedRow[]>();
  for (const r of windowRows) {
    const existing = windowByCategory.get(r.category_id);
    if (existing) existing.push(r);
    else windowByCategory.set(r.category_id, [r]);
  }
  const baselineByCategory = new Map<string, NormalisedRow[]>();
  for (const r of baselineRows) {
    const existing = baselineByCategory.get(r.category_id);
    if (existing) existing.push(r);
    else baselineByCategory.set(r.category_id, [r]);
  }

  const outliers: CategorySwingOutlier[] = [];
  for (const [category, curRows] of windowByCategory.entries()) {
    const windowSpend = curRows.reduce((s, r) => s + r.absAmount, 0);
    if (windowSpend < CATEGORY_SWING_MIN_AMOUNT) continue;

    const baseRows = baselineByCategory.get(category) ?? [];
    const baselineSpend = baseRows.reduce((s, r) => s + r.absAmount, 0);

    const windowPerDay = windowSpend / windowDays;
    const baselinePerDay = baselineSpend / baselineDays;
    // Zero baseline → would divide by zero. A brand-new category in a 90-day
    // window is more naturally reported as a first-time merchant pattern;
    // skip here rather than emit +Infinity multipliers.
    if (baselinePerDay <= 0) continue;

    const multiplier = windowPerDay / baselinePerDay;
    if (multiplier < CATEGORY_SWING_MULTIPLIER) continue;

    // Driving merchants: top 3 by spend within the category in the window.
    const merchantTotals = new Map<string, number>();
    for (const r of curRows) {
      const existing = merchantTotals.get(r.merchantKey);
      if (existing !== undefined) {
        merchantTotals.set(r.merchantKey, existing + r.absAmount);
      } else {
        merchantTotals.set(r.merchantKey, r.absAmount);
      }
    }
    const driving_merchants = Array.from(merchantTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, DRIVING_MERCHANT_LIMIT)
      .map(([merchant, amount]) => ({ merchant, amount: round2(amount) }));

    outliers.push({
      type: 'category_swing',
      category,
      context: {
        window_spend: round2(windowSpend),
        window_per_day: round2(windowPerDay),
        baseline_per_day: round2(baselinePerDay),
        multiplier: roundMultiplier(multiplier),
        driving_merchants,
      },
      why_unusual: `${category} per-day rate jumped from ${round2(baselinePerDay)} to ${round2(windowPerDay)} this period.`,
    });
  }

  outliers.sort((a, b) => b.context.multiplier - a.context.multiplier);
  return outliers;
}

export function createFindOutliersTool(ctx: ToolContext) {
  return {
    description:
      "Find unusual individual transactions or sudden shifts: one-off large purchases, brand-new merchants taking real share, or categories swinging up sharply. Use when the user's brief mentions surprise or unexplained spend, or when you want a hook that ties back to a specific transaction. Different from find_trend_changes (MoM categories) — this is sub-month outliers.",
    inputSchema,
    execute: async (input: FindOutliersInput) => {
      try {
        const { date_from, date_to, baseline_lookback_days } = input;

        // Resolve the baseline window: baseline_lookback_days BEFORE date_from.
        const baselineStartISO = subtractDaysISO(date_from, baseline_lookback_days);
        // Baseline end is the day before date_from (exclusive of the window).
        const baselineEndISO = subtractDaysISO(date_from, 1);

        const windowDays = daysBetween(date_from, date_to);
        const baselineDays = baseline_lookback_days;

        // Single query spanning baseline-start → date_to; split in JS.
        // PostgREST builder chain — same `any` convention as sibling tools.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = ctx.supabase
          .from('transactions')
          .select('id, date, description, amount, category_id')
          .eq('user_id', ctx.userId)
          .gte('date', baselineStartISO)
          .lte('date', date_to)
          .is('deleted_at', null)
          // Spend rows only — drop income/transfers/debt-repay/savings server-side.
          .not('category_id', 'in', EXCLUDED_FROM_PL_PG_LIST);

        const { data: rawRows, error } = (await query) as {
          data: DbRow[] | null;
          error: { message: string } | null;
        };

        if (error) {
          console.error('[tool:find_outliers] DB error:', error);
          return { error: 'Could not fetch transactions. Please try again.' };
        }

        // Belt-and-braces: re-filter on the client to drop anything the server
        // missed (e.g. NULL category_id). Mirrors sibling tools.
        const filtered = (rawRows ?? []).filter((r) =>
          affectsSpendingBreakdown(r.category_id),
        );

        // Normalise rows and split into baseline vs window by date string.
        const windowRows: NormalisedRow[] = [];
        const baselineRows: NormalisedRow[] = [];
        for (const r of filtered) {
          const dateKey = String(r.date).slice(0, 10);
          const signed = Number(r.amount);
          const desc = r.description ?? '';
          const normalised = normaliseMerchant(desc);
          const row: NormalisedRow = {
            id: r.id,
            date: r.date,
            description: desc || 'Unknown',
            merchantKey: normalised || 'unknown',
            amount: signed,
            absAmount: absExpense(signed),
            category_id: r.category_id as string,
          };
          if (dateKey >= date_from && dateKey <= date_to) {
            windowRows.push(row);
          } else if (dateKey >= baselineStartISO && dateKey <= baselineEndISO) {
            baselineRows.push(row);
          }
        }

        const windowTotalSpend = windowRows.reduce(
          (s, r) => s + r.absAmount,
          0,
        );

        // Confidence: span the entire period (baseline + window) so the
        // qualifier reflects how much history we're reasoning over. Tools
        // returning thin signals will be flagged downstream.
        const totalTransactions = windowRows.length + baselineRows.length;
        const totalDays = baselineDays + windowDays;
        const overallConfidence = assessDataConfidence({
          n_transactions: totalTransactions,
          n_days: totalDays,
        });

        const baseReturn = {
          filter: { date_from, date_to, baseline_lookback_days },
          currency: ctx.currency,
          window: {
            n_transactions: windowRows.length,
            n_days: windowDays,
            total_spend: round2(windowTotalSpend),
          },
          baseline: {
            n_transactions: baselineRows.length,
            n_days: baselineDays,
          },
        };

        // Track which outlier types were skipped due to thin baseline so the
        // LLM knows not to over-claim absence.
        const skippedTypes: string[] = [];

        // Type A — large one-off.
        const largeOneOffOutliers =
          baselineRows.length < LARGE_ONE_OFF_MIN_BASELINE_TXNS
            ? (skippedTypes.push('large_one_off'), [] as LargeOneOffOutlier[])
            : detectLargeOneOffs(windowRows, baselineRows);

        // Type B — first-time merchant.
        const firstTimeMerchantOutliers =
          baselineDays < NEW_MERCHANT_MIN_BASELINE_DAYS ||
          baselineRows.length < NEW_MERCHANT_MIN_BASELINE_TXNS
            ? (skippedTypes.push('first_time_merchant'),
              [] as FirstTimeMerchantOutlier[])
            : detectFirstTimeMerchants(
                windowRows,
                baselineRows,
                baselineDays,
                windowTotalSpend,
              );

        // Type C — category swing.
        const categorySwingOutliers =
          baselineDays < NEW_MERCHANT_MIN_BASELINE_DAYS ||
          baselineRows.length < NEW_MERCHANT_MIN_BASELINE_TXNS
            ? (skippedTypes.push('category_swing'),
              [] as CategorySwingOutlier[])
            : detectCategorySwings(
                windowRows,
                baselineRows,
                windowDays,
                baselineDays,
              );

        const outliers: Outlier[] = [
          ...largeOneOffOutliers,
          ...firstTimeMerchantOutliers,
          ...categorySwingOutliers,
        ];

        const confidenceReason =
          skippedTypes.length > 0
            ? `${overallConfidence.reason} Skipped outlier types due to thin baseline: ${skippedTypes.join(', ')}.`
            : overallConfidence.reason;

        return {
          ...baseReturn,
          outliers,
          data_confidence: {
            level: overallConfidence.level,
            reason: confidenceReason,
          },
        };
      } catch (err) {
        console.error('[tool:find_outliers] unexpected error:', err);
        return {
          error: 'Something went wrong finding outliers. Please try again.',
        };
      }
    },
  };
}
