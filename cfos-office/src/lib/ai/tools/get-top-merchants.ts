// cfos-office/src/lib/ai/tools/get-top-merchants.ts
//
// Top merchants by spend in a date range. Used by Claude when it needs to
// name who someone is spending the most with, compare merchant
// concentration, or pull a "biggest merchants" view.

import { z } from 'zod';
import type { ToolContext } from './types';
import { EXCLUDED_FROM_PL_PG_LIST } from '@/lib/analytics/categories';
import { groupByMerchant } from './helpers/group-by-merchant';

const inputSchema = z.object({
  date_from: z.string().describe('Start date in YYYY-MM-DD format'),
  date_to: z.string().describe('End date in YYYY-MM-DD format'),
  category: z
    .string()
    .optional()
    .describe('Category slug filter (e.g. "eat_drinking_out")'),
  value_category: z
    .enum(['foundation', 'investment', 'burden', 'leak', 'unsure'])
    .optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export type GetTopMerchantsInput = z.infer<typeof inputSchema>;

export function createGetTopMerchantsTool(ctx: ToolContext) {
  return {
    description:
      'Get the top merchants by spend in a date range. Use when you need to know who someone is spending the most with, name specific merchants in an observation, or compare merchant concentration.',
    inputSchema,
    execute: async (input: GetTopMerchantsInput) => {
      try {
        const { date_from, date_to, category, value_category, limit } = input;

        // PostgREST builder chain. Same `any` convention as other tools in
        // this folder — the chained filter API is loose-typed in practice.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = ctx.supabase
          .from('transactions')
          .select('amount, description, date, category_id, value_category')
          .eq('user_id', ctx.userId)
          .gte('date', date_from)
          .lte('date', date_to)
          .is('deleted_at', null)
          // Spend rows only — neutral / income categories don't belong here.
          .not('category_id', 'in', EXCLUDED_FROM_PL_PG_LIST);

        if (category) query = query.eq('category_id', category);
        if (value_category) query = query.eq('value_category', value_category);

        const { data: rows, error } = await query;
        if (error) {
          console.error('[tool:get_top_merchants] DB error:', error);
          return { error: 'Could not fetch merchant data. Please try again.' };
        }

        if (!rows || rows.length === 0) {
          return {
            filter: input,
            currency: ctx.currency,
            merchants: [],
            others: { total_spend: 0, transaction_count: 0 },
            error: 'No transactions match these filters.',
          };
        }

        const allGroups = groupByMerchant(
          rows.map((r: { amount: number | string; description: string | null; date: string; category_id?: string | null }) => ({
            amount: r.amount,
            description: r.description,
            date: r.date,
            category_id: r.category_id ?? null,
          })),
        );

        const topGroups = allGroups.slice(0, limit);
        const remainder = allGroups.slice(limit);

        const others = remainder.reduce(
          (acc, m) => ({
            total_spend: acc.total_spend + m.total_spend,
            transaction_count: acc.transaction_count + m.transaction_count,
          }),
          { total_spend: 0, transaction_count: 0 },
        );

        return {
          filter: input,
          currency: ctx.currency,
          merchants: topGroups,
          others: {
            total_spend: Math.round(others.total_spend * 100) / 100,
            transaction_count: others.transaction_count,
          },
        };
      } catch (err) {
        console.error('[tool:get_top_merchants] unexpected error:', err);
        return {
          error: 'Something went wrong fetching merchant data. Please try again.',
        };
      }
    },
  };
}
