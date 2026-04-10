import { z } from 'zod';
import type { ToolContext } from './types';

interface MonthData {
  month: string;
  total_spending: number;
  total_income: number;
  surplus_deficit: number | null;
  by_category: Record<string, number>;
  by_value: Record<string, number>;
  transaction_count: number;
}

async function getMonthData(
  ctx: ToolContext,
  month: string
): Promise<MonthData | null> {
  const monthDate = `${month}-01`;

  // Try snapshot first
  const { data: snapshot } = await ctx.supabase
    .from('monthly_snapshots')
    .select('*')
    .eq('user_id', ctx.userId)
    .eq('month', monthDate)
    .single();

  if (snapshot) {
    return {
      month,
      total_spending: Number(snapshot.total_spending) || 0,
      total_income: Number(snapshot.total_income) || 0,
      surplus_deficit: snapshot.surplus_deficit != null ? Number(snapshot.surplus_deficit) : null,
      by_category: (snapshot.spending_by_category as Record<string, number>) || {},
      by_value: (snapshot.spending_by_value_category as Record<string, number>) || {},
      transaction_count: snapshot.transaction_count || 0,
    };
  }

  // Fall back to computing from transactions
  const startDate = `${month}-01`;
  const endDate = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0)
    .toISOString()
    .slice(0, 10);

  const { data: transactions } = await ctx.supabase
    .from('transactions')
    .select('amount, category_id, value_category')
    .eq('user_id', ctx.userId)
    .gte('date', startDate)
    .lte('date', endDate);

  if (!transactions || transactions.length === 0) return null;

  let totalSpending = 0;
  let totalIncome = 0;
  const byCategory: Record<string, number> = {};
  const byValue: Record<string, number> = {};

  for (const t of transactions) {
    const amt = Number(t.amount);
    if (amt < 0) {
      const abs = Math.abs(amt);
      totalSpending += abs;
      const cat = t.category_id || 'uncategorised';
      byCategory[cat] = (byCategory[cat] || 0) + abs;
      const vc = t.value_category || 'no_idea';
      byValue[vc] = (byValue[vc] || 0) + abs;
    } else {
      totalIncome += amt;
    }
  }

  return {
    month,
    total_spending: Math.round(totalSpending * 100) / 100,
    total_income: Math.round(totalIncome * 100) / 100,
    surplus_deficit: Math.round((totalIncome - totalSpending) * 100) / 100,
    by_category: Object.fromEntries(
      Object.entries(byCategory).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    by_value: Object.fromEntries(
      Object.entries(byValue).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    transaction_count: transactions.length,
  };
}

export function createCompareMonthsTool(ctx: ToolContext) {
  return {
    description:
      'Compare spending between two months side-by-side. Use when the user asks "how does this month compare to last month", "was January better than February", or any month-over-month comparison.',
    inputSchema: z.object({
      month_a: z.string().describe('First month in YYYY-MM format'),
      month_b: z.string().describe('Second month in YYYY-MM format'),
    }),
    execute: async ({ month_a, month_b }: { month_a: string; month_b: string }) => {
      try {
        const [dataA, dataB] = await Promise.all([
          getMonthData(ctx, month_a),
          getMonthData(ctx, month_b),
        ]);

        if (!dataA && !dataB) {
          return { error: `No data found for either ${month_a} or ${month_b}. The user may need to upload bank statements.` };
        }
        if (!dataA) {
          return { error: `No data found for ${month_a}. Only ${month_b} has data.` };
        }
        if (!dataB) {
          return { error: `No data found for ${month_b}. Only ${month_a} has data.` };
        }

        // Compute deltas
        const totalChangePct =
          dataA.total_spending > 0
            ? Math.round(((dataB.total_spending - dataA.total_spending) / dataA.total_spending) * 1000) / 10
            : null;

        // Category deltas (top 8 by absolute change)
        const allCategories = new Set([
          ...Object.keys(dataA.by_category),
          ...Object.keys(dataB.by_category),
        ]);
        const categoryChanges = Array.from(allCategories)
          .map((cat) => {
            const a = dataA.by_category[cat] || 0;
            const b = dataB.by_category[cat] || 0;
            const change = b - a;
            const changePct = a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null;
            return { category: cat, month_a_amount: a, month_b_amount: b, change: Math.round(change * 100) / 100, change_pct: changePct };
          })
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
          .slice(0, 8);

        const biggestIncrease = categoryChanges.find((c) => c.change > 0) || null;
        const biggestDecrease = categoryChanges.find((c) => c.change < 0) || null;

        // Value category shifts
        const valueCategories = ['foundation', 'investment', 'burden', 'leak'] as const;
        const valueShifts = valueCategories.map((vc) => {
          const a = dataA.by_value[vc] || 0;
          const b = dataB.by_value[vc] || 0;
          const change = b - a;
          return {
            category: vc,
            month_a_amount: Math.round(a * 100) / 100,
            month_b_amount: Math.round(b * 100) / 100,
            change: Math.round(change * 100) / 100,
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'unchanged',
          };
        });

        return {
          month_a: dataA,
          month_b: dataB,
          changes: {
            total_change_pct: totalChangePct,
            biggest_increase: biggestIncrease,
            biggest_decrease: biggestDecrease,
            category_changes: categoryChanges,
            value_shifts: valueShifts,
          },
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:compare_months] unexpected error:', err);
        return { error: 'Something went wrong comparing months. Please try again.' };
      }
    },
  };
}
