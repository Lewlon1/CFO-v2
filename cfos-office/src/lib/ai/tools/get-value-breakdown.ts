import { z } from 'zod';
import type { ToolContext } from './types';

type ValueBreakdownRow = {
  amount: number | string;
  value_category?: string | null;
  value_confidence?: number | string | null;
  value_confirmed_by_user?: boolean | null;
  description?: string | null;
};

type BucketSummary = {
  total: number;
  percentage: number;
  count: number;
  top_items: Array<{ description: string; amount: number }>;
};

// The "confident enough to assert a value verdict" line, matching the threshold
// retake-trigger.ts / context-builder.ts use to flag rows for reclassification.
// A value_category below this AND not user-confirmed is a weak system guess —
// e.g. the 0.15 `category_default` that tagged ALL unsorted dining as 'leak'.
// Those are reported as uncategorised, never asserted as Foundation/.../Leak,
// so the breakdown reflects what the user actually sorted, not a guess.
const ASSERT_CONFIDENCE_FLOOR = 0.7;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summariseValueBreakdown(
  rows: ValueBreakdownRow[],
  confidenceFloor: number = ASSERT_CONFIDENCE_FLOOR,
): {
  breakdown: Record<string, BucketSummary>;
  uncategorised: { total: number; count: number };
  total: number;
} {
  const VALUE_CATEGORIES = ['foundation', 'investment', 'burden', 'leak'] as const;
  let total = 0;
  const buckets: Record<
    string,
    { total: number; count: number; items: Array<{ description: string; amount: number }> }
  > = {};

  for (const r of rows) {
    const abs = Math.abs(Number(r.amount));
    if (!Number.isFinite(abs)) continue;
    total += abs;
    const confidence = r.value_confidence == null ? null : Number(r.value_confidence);
    const asserted =
      r.value_confirmed_by_user === true ||
      (confidence != null && Number.isFinite(confidence) && confidence >= confidenceFloor);
    const vc =
      asserted && r.value_category && (VALUE_CATEGORIES as readonly string[]).includes(r.value_category)
        ? r.value_category
        : 'unsure';
    if (!buckets[vc]) buckets[vc] = { total: 0, count: 0, items: [] };
    buckets[vc].total += abs;
    buckets[vc].count += 1;
    buckets[vc].items.push({ description: r.description || 'Unknown', amount: abs });
  }

  const breakdown: Record<string, BucketSummary> = {};
  for (const vc of VALUE_CATEGORIES) {
    const bucket = buckets[vc];
    if (bucket) {
      const top_items = bucket.items
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3)
        .map((item) => ({ description: item.description, amount: round2(item.amount) }));
      breakdown[vc] = {
        total: round2(bucket.total),
        percentage: total > 0 ? Math.round((bucket.total / total) * 1000) / 10 : 0,
        count: bucket.count,
        top_items,
      };
    } else {
      breakdown[vc] = { total: 0, percentage: 0, count: 0, top_items: [] };
    }
  }

  const unsureBucket = buckets['unsure'];
  const uncategorised = unsureBucket
    ? { total: round2(unsureBucket.total), count: unsureBucket.count }
    : { total: 0, count: 0 };

  return { breakdown, uncategorised, total: round2(total) };
}

export function createGetValueBreakdownTool(ctx: ToolContext) {
  return {
    description:
      'Get the Foundation / Burden / Investment / Leak breakdown for a date range. Use when discussing value-based spending analysis, "show me my value breakdown", or "how much am I spending on things I consider burdens".',
    inputSchema: z.object({
      date_from: z.string().describe('Start date in YYYY-MM-DD format'),
      date_to: z.string().describe('End date in YYYY-MM-DD format'),
    }),
    execute: async ({ date_from, date_to }: { date_from: string; date_to: string }) => {
      try {
        const { data: transactions, error } = await ctx.supabase
          .from('transactions')
          .select('amount, category_id, value_category, value_confidence, value_confirmed_by_user, description')
          .eq('user_id', ctx.userId)
          .lt('amount', 0)
          .gte('date', date_from)
          .lte('date', date_to);

        if (error) {
          console.error('[tool:get_value_breakdown] DB error:', error);
          return { error: 'Could not fetch transaction data. Please try again.' };
        }

        if (!transactions || transactions.length === 0) {
          return { error: 'No transactions found for this period. The user may need to upload a bank statement.' };
        }

        const { breakdown, uncategorised, total } = summariseValueBreakdown(
          transactions as ValueBreakdownRow[],
        );

        return {
          period: { from: date_from, to: date_to },
          breakdown,
          uncategorised,
          total,
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:get_value_breakdown] unexpected error:', err);
        return { error: 'Something went wrong analysing value breakdown. Please try again.' };
      }
    },
  };
}
