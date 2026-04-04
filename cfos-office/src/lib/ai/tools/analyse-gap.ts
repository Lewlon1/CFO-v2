import { z } from 'zod';
import { analyseGap } from '@/lib/analytics/gap-analyser';
import type { ToolContext } from './types';

export function createAnalyseGapTool(ctx: ToolContext) {
  return {
    description:
      'Compare the user\'s Value Map self-perception (how they categorised hypothetical transactions) with their actual spending data. This is "The Gap" — the core insight engine. Use when discussing the difference between what the user says they value and what they actually spend on, or during monthly reviews.',
    inputSchema: z.object({
      months: z
        .number()
        .optional()
        .describe('Number of recent months to analyse. Default: 3.'),
    }),
    execute: async ({ months }: { months?: number }) => {
      try {
        const result = await analyseGap(ctx.supabase, ctx.userId, months || 3);

        if (!result.has_value_map) {
          return {
            error: 'no_value_map',
            message: 'The user hasn\'t completed the Value Map yet. Suggest they try it first — it takes about 3 minutes and makes the gap analysis possible.',
          };
        }

        if (result.gaps.length === 0) {
          return {
            error: 'no_data',
            message: 'No transaction data available for gap analysis. The user may need to upload a bank statement first.',
          };
        }

        // Cap gaps at 10 for token budget
        return {
          gaps: result.gaps.slice(0, 10),
          summary: result.summary,
          months_analysed: months || 3,
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:analyse_gap] unexpected error:', err);
        return { error: 'Something went wrong analysing the gap. Please try again.' };
      }
    },
  };
}
