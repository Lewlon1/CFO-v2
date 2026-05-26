import { z } from 'zod';
import type { ToolContext } from './types';
import { getClusterBehaviour } from '@/lib/analytics/cluster-behaviour';

/**
 * Layer 3 — Behavioural features for a merchant or category cluster.
 *
 * Returns recurrence, trend, time pattern, amount profile, and lifecycle.
 * Reads from the `merchant_aggregates` materialized view (service-role) plus
 * per-transaction details for derive functions that need date/amount granularity.
 *
 * Used by the CFO to discuss patterns ("climbing 18% per month over three months",
 * "first appeared in April", "100% weekday mornings, mean £4.65"). The CFO must
 * never invent features the tool didn't return.
 */
export function createGetClusterBehaviourTool(ctx: ToolContext) {
  return {
    description:
      "Get behavioural features for a merchant or spending category in the user's transactions. Returns recurrence pattern (daily/weekly/monthly/irregular/sparse), trend (climbing/declining/stable/volatile + slope), time pattern (weekday share, dominant day), amount profile (mean, consistency), and lifecycle (new/active/dormant/returning). Use when discussing patterns in spending, surfacing notable changes, or pointing out divergence between the user's stated intent (Value Map) and their actual behaviour. Cite specific features in your writing — do not invent any.",
    inputSchema: z.object({
      cluster_type: z
        .enum(['merchant', 'category'])
        .describe("'merchant' for a specific merchant description, 'category' for a category slug rollup."),
      cluster_id: z
        .string()
        .describe('Merchant description (e.g. "POS PURCHASE PRET A MANGER #142") or category slug (e.g. "eat_drinking_out").'),
      window_days: z
        .number()
        .int()
        .min(7)
        .max(365)
        .optional()
        .describe('Lookback window in days. Default 90.'),
    }),
    execute: async ({
      cluster_type,
      cluster_id,
      window_days,
    }: {
      cluster_type: 'merchant' | 'category';
      cluster_id: string;
      window_days?: number;
    }) => {
      try {
        return await getClusterBehaviour({
          userId: ctx.userId,
          clusterType: cluster_type,
          clusterId: cluster_id,
          windowDays: window_days ?? 90,
        });
      } catch (err) {
        console.error('[tool:get_cluster_behaviour] error:', err);
        return { error: 'Could not derive behaviour for this cluster.' };
      }
    },
  };
}
