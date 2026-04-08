import { z } from 'zod';
import type { ToolContext } from './types';

export function createGetNetWorthHistoryTool(ctx: ToolContext) {
  return {
    description: `Get the user's net worth trend over time from monthly snapshots.

WHEN TO CALL: When the user asks how their net worth has changed, wants to see progress over time, or during monthly reviews.

VALID FIELDS:
- months: number — optional. How many months of history. Default 12. Max 60.

RETURNS: Array of monthly snapshots in chronological order with net_worth, total_assets, total_liabilities, and month-over-month changes. Empty array if no snapshots exist.`,
    inputSchema: z.object({
      months: z.number().int().min(1).max(60).optional(),
    }),
    execute: async (params: { months?: number }) => {
      try {
        const limit = Math.min(params.months ?? 12, 60);

        const { data: snapshots, error } = await ctx.supabase
          .from('net_worth_snapshots')
          .select(
            'month, total_assets, total_liabilities, net_worth, accessible_assets, locked_assets, net_worth_change, net_worth_change_pct'
          )
          .eq('user_id', ctx.userId)
          .order('month', { ascending: false })
          .limit(limit);

        if (error) {
          console.error('[tool:get_net_worth_history] fetch error:', error);
          return { error: 'Could not load your net worth history. Please try again.' };
        }

        const rows = (snapshots || []).slice().reverse(); // chronological

        return {
          months_returned: rows.length,
          history: rows.map((s) => ({
            month: s.month,
            total_assets: Number(s.total_assets) || 0,
            total_liabilities: Number(s.total_liabilities) || 0,
            net_worth: Number(s.net_worth) || 0,
            accessible_assets: Number(s.accessible_assets) || 0,
            locked_assets: Number(s.locked_assets) || 0,
            net_worth_change: s.net_worth_change != null ? Number(s.net_worth_change) : null,
            net_worth_change_pct: s.net_worth_change_pct != null ? Number(s.net_worth_change_pct) : null,
          })),
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:get_net_worth_history] unexpected error:', err);
        return { error: 'Something went wrong loading your net worth history.' };
      }
    },
  };
}
