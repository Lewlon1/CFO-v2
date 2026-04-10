import { z } from 'zod';
import type { ToolContext } from './types';

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
          .select('amount, category_id, value_category, description')
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

        const total = transactions.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

        // Group by value_category
        const buckets: Record<string, { total: number; count: number; items: Array<{ description: string; amount: number }> }> = {};

        for (const t of transactions) {
          const vc = t.value_category || 'no_idea';
          if (!buckets[vc]) buckets[vc] = { total: 0, count: 0, items: [] };
          const abs = Math.abs(Number(t.amount));
          buckets[vc].total += abs;
          buckets[vc].count += 1;
          buckets[vc].items.push({ description: t.description || 'Unknown', amount: abs });
        }

        // Build breakdown with top 3 items per bucket
        const valueCategories = ['foundation', 'investment', 'burden', 'leak'] as const;
        const breakdown: Record<string, { total: number; percentage: number; count: number; top_items: Array<{ description: string; amount: number }> }> = {};

        for (const vc of valueCategories) {
          const bucket = buckets[vc];
          if (bucket) {
            const topItems = bucket.items
              .sort((a, b) => b.amount - a.amount)
              .slice(0, 3)
              .map((item) => ({
                description: item.description,
                amount: Math.round(item.amount * 100) / 100,
              }));

            breakdown[vc] = {
              total: Math.round(bucket.total * 100) / 100,
              percentage: Math.round((bucket.total / total) * 1000) / 10,
              count: bucket.count,
              top_items: topItems,
            };
          } else {
            breakdown[vc] = { total: 0, percentage: 0, count: 0, top_items: [] };
          }
        }

        const noIdeaBucket = buckets['no_idea'];
        const uncategorised = noIdeaBucket
          ? { total: Math.round(noIdeaBucket.total * 100) / 100, count: noIdeaBucket.count }
          : { total: 0, count: 0 };

        return {
          period: { from: date_from, to: date_to },
          breakdown,
          uncategorised,
          total: Math.round(total * 100) / 100,
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:get_value_breakdown] unexpected error:', err);
        return { error: 'Something went wrong analysing value breakdown. Please try again.' };
      }
    },
  };
}
