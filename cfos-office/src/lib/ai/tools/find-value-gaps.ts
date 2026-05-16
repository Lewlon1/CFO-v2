// cfos-office/src/lib/ai/tools/find-value-gaps.ts
//
// Thin wrapper around analyseGapV2 (Phase 3 of Session v2.2).
// Returns gaps + value_map_metadata so the LLM can decide how much weight
// to put on the user's stated Value Map (factoring in staleness and coverage).

import { z } from 'zod';
import { analyseGapV2 } from '@/lib/analytics/gap-analyser';
import type { ToolContext } from './types';

const inputSchema = z.object({
  months: z
    .number()
    .int()
    .min(1)
    .max(12)
    .default(3)
    .describe('Lookback window in months for actual spend'),
});

export type FindValueGapsInput = z.infer<typeof inputSchema>;

export function createFindValueGapsTool(ctx: ToolContext) {
  return {
    description:
      "Find gaps between the user's stated Value Map and where their money actually goes. Returns one entry per category in the Value Map (single-intent or multi-intent) plus coverage gaps for categories the user has actual spend in but no VM card for. Use early when assessing the user's relationship with their spending, or after find_money_clusters returns a category-heavy story and you want to see what the user said about that category.",
    inputSchema,
    execute: async ({ months }: FindValueGapsInput) => {
      try {
        const result = await analyseGapV2(ctx.supabase, ctx.userId, months);
        return {
          has_value_map: result.has_value_map,
          gaps: result.gaps,
          value_map_metadata: result.value_map_metadata,
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:find_value_gaps] error:', err);
        return { error: 'Could not compute value gaps. Please try again.' };
      }
    },
  };
}
