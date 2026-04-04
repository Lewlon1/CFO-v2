import { z } from 'zod';
import type { ToolContext } from './types';

export function createGetSpendingSummaryTool(ctx: ToolContext) {
  return {
    description:
      'Get spending data for a date range, optionally filtered by traditional category or value category. Use when the user asks "how much did I spend", "what did I spend on X", or any spending question for a specific period.',
    inputSchema: z.object({
      date_from: z.string().describe('Start date in YYYY-MM-DD format'),
      date_to: z.string().describe('End date in YYYY-MM-DD format'),
      category: z.string().optional().describe('Optional traditional category slug to filter by (e.g. "eat_drinking_out", "groceries")'),
      value_category: z
        .enum(['foundation', 'investment', 'burden', 'leak'])
        .optional()
        .describe('Optional value category to filter by'),
    }),
    execute: async ({
      date_from,
      date_to,
      category,
      value_category,
    }: {
      date_from: string;
      date_to: string;
      category?: string;
      value_category?: string;
    }) => {
      try {
        let query = ctx.supabase
          .from('transactions')
          .select('amount, category_id, value_category, description, date')
          .eq('user_id', ctx.userId)
          .lt('amount', 0)
          .gte('date', date_from)
          .lte('date', date_to);

        if (category) query = query.eq('category_id', category);
        if (value_category) query = query.eq('value_category', value_category);

        const { data: transactions, error } = await query;

        if (error) {
          console.error('[tool:get_spending_summary] DB error:', error);
          return { error: 'Could not fetch spending data. Please try again.' };
        }

        if (!transactions || transactions.length === 0) {
          return {
            error: 'No transactions found for this period. The user may need to upload a bank statement.',
          };
        }

        // Aggregate totals
        const total = transactions.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
        const count = transactions.length;
        const avg = total / count;

        // Top merchants (by description, top 5)
        const merchantMap = new Map<string, { total: number; count: number }>();
        for (const t of transactions) {
          const desc = t.description || 'Unknown';
          const existing = merchantMap.get(desc) || { total: 0, count: 0 };
          existing.total += Math.abs(Number(t.amount));
          existing.count += 1;
          merchantMap.set(desc, existing);
        }
        const topMerchants = Array.from(merchantMap.entries())
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, 5)
          .map(([description, data]) => ({
            description,
            total: Math.round(data.total * 100) / 100,
            count: data.count,
          }));

        // Category breakdown (top 8)
        const categoryMap = new Map<string, number>();
        for (const t of transactions) {
          const cat = t.category_id || 'uncategorised';
          categoryMap.set(cat, (categoryMap.get(cat) || 0) + Math.abs(Number(t.amount)));
        }
        const categoryBreakdown = Array.from(categoryMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([cat, amount]) => ({
            category: cat,
            total: Math.round(amount * 100) / 100,
            percentage: Math.round((amount / total) * 1000) / 10,
          }));

        // Value breakdown
        const valueMap = new Map<string, number>();
        for (const t of transactions) {
          const vc = t.value_category || 'unsure';
          valueMap.set(vc, (valueMap.get(vc) || 0) + Math.abs(Number(t.amount)));
        }
        const valueBreakdown: Record<string, number> = {};
        for (const [vc, amount] of valueMap.entries()) {
          valueBreakdown[vc] = Math.round(amount * 100) / 100;
        }

        return {
          date_range: { from: date_from, to: date_to },
          total_spending: Math.round(total * 100) / 100,
          transaction_count: count,
          avg_transaction: Math.round(avg * 100) / 100,
          top_merchants: topMerchants,
          category_breakdown: categoryBreakdown,
          value_breakdown: valueBreakdown,
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:get_spending_summary] unexpected error:', err);
        return { error: 'Something went wrong fetching spending data. Please try again.' };
      }
    },
  };
}
