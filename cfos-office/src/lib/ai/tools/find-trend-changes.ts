// cfos-office/src/lib/ai/tools/find-trend-changes.ts
//
// Detective tool: find categories whose spend has accelerated or decelerated
// month-over-month. Returns story-shaped category deltas + the merchants
// driving each shift. The LLM picks which (if any) of these to talk through.
//
// Requires at least 2 calendar months of data — returns null with reason
// 'insufficient_history' when only the current month has spend.

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

const DRIVING_MERCHANT_LIMIT = 3;
const THIN_MONTH_TXN_THRESHOLD = 10;

const inputSchema = z.object({
  date_to: z
    .string()
    .describe(
      'Anchor date (YYYY-MM-DD); the tool looks at the calendar month containing this date as "current" and the previous calendar month as "baseline"',
    ),
  min_delta_pct: z
    .number()
    .default(20)
    .describe(
      'Minimum absolute delta percent to surface a category as a trend change (default 20%)',
    ),
  min_amount: z
    .number()
    .default(20)
    .describe(
      'Minimum absolute spend amount in the current month for a category to be considered (default 20)',
    ),
});

export type FindTrendChangesInput = z.infer<typeof inputSchema>;

export interface TrendChange {
  category: string;
  current_amount: number;
  baseline_amount: number;
  mom_delta_pct: number;
  mom_delta_amount: number;
  driving_merchants: Array<{ merchant: string; delta_amount: number }>;
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
  date: string;
  description: string;
  merchantKey: string;
  amount: number;       // signed
  absAmount: number;    // absolute spend (refunds → 0)
  category_id: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

// First day of the calendar month containing the given anchor date (UTC).
// Uses Date.UTC to avoid host-TZ drift on month boundaries.
function monthStartUTC(anchorISO: string): Date {
  const anchor = new Date(anchorISO);
  if (!Number.isFinite(anchor.getTime())) {
    return new Date(NaN);
  }
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
}

// Add N months to a month-start date (UTC).
function addMonthsUTC(monthStart: Date, months: number): Date {
  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + months, 1),
  );
}

// 'YYYY-MM-DD' (UTC slice).
function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 'YYYY-MM' (UTC slice).
function toYearMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function pickNarrativeHint(opts: {
  direction: 'up' | 'down';
  baselineAmount: number;
  drivingMerchants: Array<{ merchant: string; delta_amount: number }>;
  currentTotalForCategory: number;
}): string {
  const { direction, baselineAmount, drivingMerchants, currentTotalForCategory } = opts;

  // Brand-new category: no baseline spend at all → fresh appearance.
  if (direction === 'up' && baselineAmount <= 0 && drivingMerchants[0]) {
    return 'New merchant doing most of the work — first month or one-off?';
  }

  // Single merchant carrying most of the shift.
  if (drivingMerchants.length > 0 && currentTotalForCategory > 0) {
    const topAbs = Math.abs(drivingMerchants[0].delta_amount);
    const totalAbs = drivingMerchants.reduce(
      (s, m) => s + Math.abs(m.delta_amount),
      0,
    );
    if (totalAbs > 0 && topAbs / totalAbs >= 0.6) {
      return direction === 'up'
        ? 'One merchant driving most of the rise — worth asking what changed.'
        : 'One merchant driving most of the drop — deliberate, or just rhythm?';
    }
  }

  return direction === 'up'
    ? 'Up sharply from last month — worth asking what changed.'
    : 'Down from last month — deliberate, or just rhythm?';
}

export function createFindTrendChangesTool(ctx: ToolContext) {
  return {
    description:
      "Find categories whose spend has accelerated or decelerated month-over-month. Use when the user's brief mentions recent changes or after seeing a money_clusters result that's heavier than expected — this tells you whether it's a new trend or steady-state. Returns null when there's only one month of data.",
    inputSchema,
    execute: async (input: FindTrendChangesInput) => {
      try {
        const { date_to, min_delta_pct, min_amount } = input;

        const currentMonthStart = monthStartUTC(date_to);
        if (!Number.isFinite(currentMonthStart.getTime())) {
          return { error: 'Invalid date_to. Use YYYY-MM-DD.' };
        }
        const currentMonthEnd = new Date(
          addMonthsUTC(currentMonthStart, 1).getTime() - 1,
        );
        const baselineMonthStart = addMonthsUTC(currentMonthStart, -1);
        const baselineMonthEnd = new Date(currentMonthStart.getTime() - 1);

        const queryFrom = toDateOnly(baselineMonthStart);
        const queryTo = toDateOnly(currentMonthEnd);

        const currentMonthLabel = toYearMonth(currentMonthStart);
        const baselineMonthLabel = toYearMonth(baselineMonthStart);

        // PostgREST builder chain — same `any` convention as sibling tools.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = ctx.supabase
          .from('transactions')
          .select('id, date, description, amount, category_id')
          .eq('user_id', ctx.userId)
          .gte('date', queryFrom)
          .lte('date', queryTo)
          .is('deleted_at', null)
          // Spend rows only — drop income/transfers/debt-repay/savings server-side.
          .not('category_id', 'in', EXCLUDED_FROM_PL_PG_LIST);

        const { data: rawRows, error } = (await query) as {
          data: DbRow[] | null;
          error: { message: string } | null;
        };

        if (error) {
          console.error('[tool:find_trend_changes] DB error:', error);
          return { error: 'Could not fetch transactions. Please try again.' };
        }

        // Belt-and-braces: re-filter on the client to drop anything the server
        // missed (e.g. NULL category_id). Mirrors sibling tools.
        const filtered = (rawRows ?? []).filter((r) =>
          affectsSpendingBreakdown(r.category_id),
        );

        const currentRows: NormalisedRow[] = [];
        const baselineRows: NormalisedRow[] = [];

        const baselineStartISO = queryFrom;
        const baselineEndISO = toDateOnly(baselineMonthEnd);
        const currentStartISO = toDateOnly(currentMonthStart);
        const currentEndISO = queryTo;

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
          if (dateKey >= currentStartISO && dateKey <= currentEndISO) {
            currentRows.push(row);
          } else if (dateKey >= baselineStartISO && dateKey <= baselineEndISO) {
            baselineRows.push(row);
          }
        }

        const currentTotal = currentRows.reduce((s, r) => s + r.absAmount, 0);
        const baselineTotal = baselineRows.reduce((s, r) => s + r.absAmount, 0);

        const baseFilter = { date_to, min_delta_pct, min_amount };

        // Insufficient history: only one of the two months has any spend.
        // This is what 'a category present in only the current month' means at
        // the aggregate level — without a baseline we can't compute a delta.
        if (baselineRows.length === 0) {
          return {
            filter: baseFilter,
            currency: ctx.currency,
            result: null,
            reason: 'insufficient_history',
            data_confidence: {
              level: 'low' as const,
              reason: 'Need at least 2 months of data to compute trend changes.',
            },
          };
        }

        // Aggregate by category for each window.
        const currentByCategory = new Map<string, NormalisedRow[]>();
        for (const r of currentRows) {
          const existing = currentByCategory.get(r.category_id);
          if (existing) existing.push(r);
          else currentByCategory.set(r.category_id, [r]);
        }
        const baselineByCategory = new Map<string, NormalisedRow[]>();
        for (const r of baselineRows) {
          const existing = baselineByCategory.get(r.category_id);
          if (existing) existing.push(r);
          else baselineByCategory.set(r.category_id, [r]);
        }

        const allCategories = new Set<string>([
          ...currentByCategory.keys(),
          ...baselineByCategory.keys(),
        ]);

        // Confidence: 60-day window combining both months. Downgrade if either
        // month is thin (< THIN_MONTH_TXN_THRESHOLD).
        const overallConfidence = assessDataConfidence({
          n_transactions: currentRows.length + baselineRows.length,
          n_days: 60,
        });
        const eitherMonthThin =
          currentRows.length < THIN_MONTH_TXN_THRESHOLD ||
          baselineRows.length < THIN_MONTH_TXN_THRESHOLD;
        const confidenceLevel: DataConfidence = eitherMonthThin
          ? overallConfidence.level === 'high'
            ? 'medium'
            : 'low'
          : overallConfidence.level;
        const confidenceReason = eitherMonthThin
          ? `Thin month sample (current=${currentRows.length}, baseline=${baselineRows.length}) — downgrading from ${overallConfidence.level}.`
          : overallConfidence.reason;

        const accelerating: TrendChange[] = [];
        const decelerating: TrendChange[] = [];

        for (const category of allCategories) {
          const curRows = currentByCategory.get(category) ?? [];
          const baseRows = baselineByCategory.get(category) ?? [];
          const curTotal = curRows.reduce((s, r) => s + r.absAmount, 0);
          const baseTotal = baseRows.reduce((s, r) => s + r.absAmount, 0);

          // Current spend gate: skip categories with negligible current spend.
          if (curTotal < min_amount) continue;

          // Delta using max(baseline, current) in denominator. This caps
          // brand-new categories (baseline=0) at +100% rather than +Infinity.
          const denom = Math.max(baseTotal, curTotal);
          if (denom <= 0) continue;
          const deltaAmount = curTotal - baseTotal;
          const deltaPct = (deltaAmount / denom) * 100;

          if (Math.abs(deltaPct) < min_delta_pct) continue;

          // Compute per-merchant deltas inside the category.
          const merchantTotals = new Map<
            string,
            { current: number; baseline: number }
          >();
          for (const r of curRows) {
            const existing = merchantTotals.get(r.merchantKey);
            if (existing) existing.current += r.absAmount;
            else
              merchantTotals.set(r.merchantKey, {
                current: r.absAmount,
                baseline: 0,
              });
          }
          for (const r of baseRows) {
            const existing = merchantTotals.get(r.merchantKey);
            if (existing) existing.baseline += r.absAmount;
            else
              merchantTotals.set(r.merchantKey, {
                current: 0,
                baseline: r.absAmount,
              });
          }

          const merchantDeltas = Array.from(merchantTotals.entries()).map(
            ([merchant, totals]) => ({
              merchant,
              delta_amount: round2(totals.current - totals.baseline),
            }),
          );

          // For accelerating categories, surface merchants that grew the most
          // (largest positive delta). For decelerating, surface those that
          // shrank the most (largest negative delta). Sort by signed direction
          // so a single accelerating-category list doesn't get polluted by
          // merchants that fell. Take top 3.
          const direction: 'up' | 'down' = deltaAmount > 0 ? 'up' : 'down';
          const sortedMerchants =
            direction === 'up'
              ? merchantDeltas
                  .filter((m) => m.delta_amount > 0)
                  .sort((a, b) => b.delta_amount - a.delta_amount)
              : merchantDeltas
                  .filter((m) => m.delta_amount < 0)
                  .sort((a, b) => a.delta_amount - b.delta_amount);
          const drivingMerchants = sortedMerchants.slice(0, DRIVING_MERCHANT_LIMIT);

          const narrativeHint = pickNarrativeHint({
            direction,
            baselineAmount: baseTotal,
            drivingMerchants,
            currentTotalForCategory: curTotal,
          });

          const change: TrendChange = {
            category,
            current_amount: round2(curTotal),
            baseline_amount: round2(baseTotal),
            mom_delta_pct: roundPct(deltaPct),
            mom_delta_amount: round2(deltaAmount),
            driving_merchants: drivingMerchants,
            narrative_hint: narrativeHint,
            data_confidence: confidenceLevel,
          };

          if (direction === 'up') accelerating.push(change);
          else decelerating.push(change);
        }

        // Sort each list by absolute delta amount (currency-denominated) desc.
        accelerating.sort(
          (a, b) => Math.abs(b.mom_delta_amount) - Math.abs(a.mom_delta_amount),
        );
        decelerating.sort(
          (a, b) => Math.abs(b.mom_delta_amount) - Math.abs(a.mom_delta_amount),
        );

        return {
          filter: baseFilter,
          currency: ctx.currency,
          windows: {
            current: {
              month: currentMonthLabel,
              total_spend: round2(currentTotal),
              n_transactions: currentRows.length,
            },
            baseline: {
              month: baselineMonthLabel,
              total_spend: round2(baselineTotal),
              n_transactions: baselineRows.length,
            },
          },
          accelerating,
          decelerating,
          data_confidence: {
            level: confidenceLevel,
            reason: confidenceReason,
          },
        };
      } catch (err) {
        console.error('[tool:find_trend_changes] unexpected error:', err);
        return {
          error: 'Something went wrong finding trend changes. Please try again.',
        };
      }
    },
  };
}
