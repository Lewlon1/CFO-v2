// cfos-office/src/lib/ai/tools/get-transactions.ts
//
// Get a filtered list of individual transactions. Used by Claude when it
// needs to point to specific rows (real merchants, real amounts) rather
// than aggregates.

import { z } from 'zod';
import type { ToolContext } from './types';
import { EXCLUDED_FROM_PL_PG_LIST } from '@/lib/analytics/categories';

const inputSchema = z.object({
  date_from: z.string().describe('Start date in YYYY-MM-DD format'),
  date_to: z.string().describe('End date in YYYY-MM-DD format'),
  merchant_pattern: z
    .string()
    .optional()
    .describe('Case-insensitive substring match on transaction description'),
  category: z
    .string()
    .optional()
    .describe('Category slug filter (e.g. "eat_drinking_out")'),
  value_category: z
    .enum(['foundation', 'investment', 'burden', 'leak', 'unsure'])
    .optional(),
  min_amount: z
    .number()
    .optional()
    .describe('Inclusive minimum absolute amount'),
  max_amount: z
    .number()
    .optional()
    .describe('Inclusive maximum absolute amount'),
  direction: z
    .enum(['spend', 'income', 'all'])
    .default('spend')
    .describe('Spend (outflows), income (inflows), or all'),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc']).default('date_desc'),
  limit: z.number().int().min(1).max(50).default(20),
});

export type GetTransactionsInput = z.infer<typeof inputSchema>;

// PostgREST query builder type. The SupabaseClient generic types don't
// surface a single chainable interface that captures all the filter
// methods we need; the local convention in this folder is to type the
// chain loosely with an inline `any` and an eslint-disable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = any;

export function createGetTransactionsTool(ctx: ToolContext) {
  return {
    description:
      'Get individual transactions matching filters. Use when the user asks about specific transactions, when you need to see real merchant names and amounts (not aggregates), or when a follow-up question needs you to point to specific rows.',
    inputSchema,
    execute: async (input: GetTransactionsInput) => {
      try {
        const {
          date_from,
          date_to,
          merchant_pattern,
          category,
          value_category,
          min_amount,
          max_amount,
          direction,
          sort,
          limit,
        } = input;

        // Build the base filter chain. Used twice — once for the count,
        // once for the row fetch — so they stay in lock-step.
        const applyFilters = (q: QueryBuilder): QueryBuilder => {
          let qq = q
            .eq('user_id', ctx.userId)
            .gte('date', date_from)
            .lte('date', date_to)
            // Soft-delete pin: exclude rows the user has removed.
            .is('deleted_at', null);

          if (direction === 'spend') {
            qq = qq
              .not('category_id', 'in', EXCLUDED_FROM_PL_PG_LIST)
              .lt('amount', 0);
          } else if (direction === 'income') {
            qq = qq.gt('amount', 0);
          }
          // direction === 'all' applies no amount-sign filter.

          if (category) qq = qq.eq('category_id', category);
          if (value_category) qq = qq.eq('value_category', value_category);
          if (merchant_pattern) qq = qq.ilike('description', `%${merchant_pattern}%`);

          // min/max are absolute-value filters: e.g. "show transactions ≥ £50"
          // applies to |amount|, not to signed amount. PostgREST has no native
          // abs(), so apply via .or() on the signed columns.
          if (min_amount !== undefined) {
            qq = qq.or(`amount.gte.${min_amount},amount.lte.${-min_amount}`);
          }
          if (max_amount !== undefined) {
            qq = qq.or(`amount.lte.${max_amount},amount.gte.${-max_amount}`);
          }

          return qq;
        };

        // Count first so we know if we need to flag truncation. `head: true`
        // returns no rows, just the count — cheap.
        const countQuery = applyFilters(
          ctx.supabase
            .from('transactions')
            .select('id', { count: 'exact', head: true }),
        );
        const { count: total_matching_rows, error: countError } = await countQuery;
        if (countError) {
          console.error('[tool:get_transactions] count error:', countError);
          return { error: 'Could not fetch transactions. Please try again.' };
        }

        // Now fetch the rows themselves.
        let rowQuery = applyFilters(
          ctx.supabase
            .from('transactions')
            .select('id, date, description, amount, category_id, value_category'),
        );
        if (sort === 'date_desc') rowQuery = rowQuery.order('date', { ascending: false });
        else if (sort === 'date_asc') rowQuery = rowQuery.order('date', { ascending: true });
        else if (sort === 'amount_desc') rowQuery = rowQuery.order('amount', { ascending: true });
        // amount_desc means "biggest spend first". Since spend is negative,
        // ascending by signed amount returns the most negative first.

        rowQuery = rowQuery.limit(limit);

        const { data: rows, error: rowError } = (await rowQuery) as {
          data: Array<{
            id: string;
            date: string;
            description: string | null;
            amount: number | string;
            category_id: string | null;
            value_category: string | null;
          }> | null;
          error: { message: string } | null;
        };
        if (rowError) {
          console.error('[tool:get_transactions] row error:', rowError);
          return { error: 'Could not fetch transactions. Please try again.' };
        }

        const rowCount = rows?.length ?? 0;
        const totalCount = total_matching_rows ?? rowCount;
        const truncated = totalCount > rowCount;

        if (rowCount === 0) {
          return {
            filter: input,
            summary: {
              row_count: 0,
              truncated: false,
              total_matching_rows: totalCount,
              total_amount: 0,
              currency: ctx.currency,
            },
            transactions: [],
            error: 'No transactions match these filters.',
          };
        }

        const total_amount = (rows ?? []).reduce(
          (sum, r) => sum + Number(r.amount),
          0,
        );

        const transactions = (rows ?? []).map((r) => ({
          id: r.id,
          date: r.date,
          merchant: r.description ?? '',
          amount: Math.round(Number(r.amount) * 100) / 100,
          category: r.category_id ?? null,
          value_category: r.value_category ?? null,
        }));

        return {
          filter: input,
          summary: {
            row_count: rowCount,
            truncated,
            total_matching_rows: totalCount,
            total_amount: Math.round(total_amount * 100) / 100,
            currency: ctx.currency,
          },
          transactions,
        };
      } catch (err) {
        console.error('[tool:get_transactions] unexpected error:', err);
        return {
          error: 'Something went wrong fetching transactions. Please try again.',
        };
      }
    },
  };
}
