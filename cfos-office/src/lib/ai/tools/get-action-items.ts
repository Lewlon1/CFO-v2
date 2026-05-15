import { z } from 'zod';
import type { ToolContext } from './types';
import { getPrimaryGoal } from '@/lib/goals/primary-goal';
import { rankActionItems } from './action-item-ranking';

type ActionItemRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string | null;
  due_date: string | null;
  created_at: string | null;
  priority: string | null;
  goal_id: string | null;
};

export function createGetActionItemsTool(ctx: ToolContext) {
  return {
    description:
      'Retrieve the user\'s action items, optionally filtered by status. Use when the user asks about their to-do list, pending actions, progress, or "what should I be working on". Items are returned ranked: actions tied to the user\'s primary goal first, then goal-adjacent categories, then the rest — within each tier, higher priority and more recent items lead.',
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

        let primaryGoalId: string | null = null;
        try {
          const primaryGoal = await getPrimaryGoal(ctx.supabase, ctx.userId);
          primaryGoalId = primaryGoal?.id ?? null;
        } catch (goalErr) {
          console.error('[tool:get_action_items] primary goal lookup failed:', goalErr);
        }

        let query = ctx.supabase
          .from('action_items')
          .select('id, title, description, category, status, due_date, created_at, priority, goal_id')
          .eq('user_id', ctx.userId);

        if (status && status !== 'all') {
          query = query.eq('status', status);
        } else if (!status) {
          query = query.in('status', ['pending', 'in_progress']);
        }

        const { data: rows, error } = await query;

        if (error) {
          console.error('[tool:get_action_items] DB error:', error);
          return { error: 'Could not fetch action items. Please try again.' };
        }

        if (!rows || rows.length === 0) {
          return {
            action_items: [],
            total_count: 0,
            message: 'No action items found. Create some during our conversations when we identify things to work on.',
          };
        }

        const ranked = rankActionItems(rows as ActionItemRow[], primaryGoalId).slice(0, maxItems);

        return {
          action_items: ranked.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            category: item.category,
            status: item.status,
            due_date: item.due_date,
            created_at: item.created_at,
            priority: item.priority,
            goal_id: item.goal_id,
          })),
          total_count: ranked.length,
        };
      } catch (err) {
        console.error('[tool:get_action_items] unexpected error:', err);
        return { error: 'Something went wrong fetching action items. Please try again.' };
      }
    },
  };
}
