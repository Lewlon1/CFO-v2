import { z } from 'zod';
import type { ToolContext } from './types';

// Divides a total by a period count. The CFO calls this instead of doing
// "£167 over 2 months → £84/month" in chat — arithmetic ban in BASE_PERSONA
// points here for any per-period halving or averaging.
//
// Intentionally minimal: this is a guardrail, not a richer analytics tool.
// For per-category averages backed by transactions, use get_spending_summary
// or compare_months.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createComputePeriodAverageTool(_ctx: ToolContext) {
  return {
    description:
      "Divide a total by a number of periods to get a per-period figure (e.g. spent £200 across 4 weeks → £50/week). Use this for any 'X over N periods → per-period' calculation — do not compute it yourself in chat. For category averages drawn from real transaction history, prefer get_spending_summary instead.",
    inputSchema: z.object({
      total: z
        .number()
        .describe('The total amount to divide. May be negative for outflows.'),
      period_count: z
        .number()
        .int()
        .positive()
        .describe('Number of periods to divide by. Must be a positive integer.'),
      period_unit: z
        .enum(['day', 'week', 'month', 'year'])
        .describe('Unit of the periods, used only for the response label.'),
    }),
    execute: async ({
      total,
      period_count,
      period_unit,
    }: {
      total: number;
      period_count: number;
      period_unit: 'day' | 'week' | 'month' | 'year';
    }) => {
      const per_period = total / period_count;
      const rounded = Math.round(per_period * 100) / 100;
      return {
        success: true,
        total,
        period_count,
        period_unit,
        per_period: rounded,
        label: `${rounded.toLocaleString()} per ${period_unit}`,
      };
    },
  };
}
