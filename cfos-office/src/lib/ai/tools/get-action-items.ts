import { z } from 'zod';
import type { ToolContext } from './types';

export function createGetActionItemsTool(ctx: ToolContext) {
  return {
    description:
      'Retrieve the user\'s action items, optionally filtered by status. Use when the user asks about their to-do list, pending actions, progress, or "what should I be working on".',
    inputSchema: z.object({
      status: z
        .enum(['pending', 'in_progress', 'completed', 'all'])
        .optional()
        .describe('Filter by status. Default: returns pending and in_progress items.'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of items to return. Default: 10, max: 20.'),
    }),
    execute: async ({ status, limit }: { status?: string; limit?: number }) => {
      try {
        const maxItems = Math.min(limit || 10, 20);

        let query = ctx.supabase
          .from('action_items')
          .select('id, title, description, category, status, due_date, created_at')
          .eq('profile_id', ctx.userId)
          .order('created_at', { ascending: false })
          .limit(maxItems);

        if (status && status !== 'all') {
          query = query.eq('status', status);
        } else if (!status) {
          // Default: pending + in_progress
          query = query.in('status', ['pending', 'in_progress']);
        }

        const { data: items, error } = await query;

        if (error) {
          console.error('[tool:get_action_items] DB error:', error);
          return { error: 'Could not fetch action items. Please try again.' };
        }

        if (!items || items.length === 0) {
          return {
            action_items: [],
            total_count: 0,
            message: 'No action items found. Create some during our conversations when we identify things to work on.',
          };
        }

        return {
          action_items: items,
          total_count: items.length,
        };
      } catch (err) {
        console.error('[tool:get_action_items] unexpected error:', err);
        return { error: 'Something went wrong fetching action items. Please try again.' };
      }
    },
  };
}
