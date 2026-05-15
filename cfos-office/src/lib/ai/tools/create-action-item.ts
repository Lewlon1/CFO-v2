import { z } from 'zod';
import type { ToolContext } from './types';
import { getPrimaryGoal } from '@/lib/goals/primary-goal';

const GOAL_ADJACENT_CATEGORIES = new Set(['goal_setting', 'savings_transfer']);

export function createCreateActionItemTool(ctx: ToolContext) {
  return {
    description:
      'Create a tracked action item for the user. Use when the conversation produces a concrete next step, e.g. "I should cancel that gym membership", "switch electricity provider", or "set up a savings transfer". Confirm the action with the user before calling this tool. Pass goal_id when the action ties to a specific goal — otherwise actions in the goal_setting or savings_transfer categories will be auto-linked to the user\'s primary goal.',
    inputSchema: z.object({
      title: z.string().max(200).describe('Short, actionable title'),
      description: z.string().max(500).optional().describe('Additional details or context'),
      category: z
        .enum([
          'bill_switch',
          'savings_transfer',
          'investment',
          'admin',
          'research',
          'spending_change',
          'goal_setting',
        ])
        .describe('Action category'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level (optional)'),
      due_date: z.string().optional().describe('Due date in YYYY-MM-DD format, if applicable'),
      goal_id: z
        .string()
        .uuid()
        .optional()
        .describe('Optional UUID of the goal this action serves. Pass when the action directly contributes to a known goal.'),
    }),
    execute: async ({
      title,
      description,
      category,
      priority,
      due_date,
      goal_id,
    }: {
      title: string;
      description?: string;
      category: string;
      priority?: string;
      due_date?: string;
      goal_id?: string;
    }) => {
      try {
        let resolvedGoalId: string | null = goal_id ?? null;

        if (!resolvedGoalId && GOAL_ADJACENT_CATEGORIES.has(category)) {
          try {
            const primaryGoal = await getPrimaryGoal(ctx.supabase, ctx.userId);
            resolvedGoalId = primaryGoal?.id ?? null;
          } catch (lookupErr) {
            console.error('[tool:create_action_item] primary goal lookup failed:', lookupErr);
          }
        }

        const { data, error } = await ctx.supabase
          .from('action_items')
          .insert({
            user_id: ctx.userId,
            conversation_id: ctx.conversationId,
            title,
            description: description || null,
            category,
            priority: priority || 'medium',
            due_date: due_date || null,
            goal_id: resolvedGoalId,
            status: 'pending',
          })
          .select('id, title, category, priority, due_date, goal_id')
          .single();

        if (error) {
          console.error('[tool:create_action_item] DB error:', error);
          return { error: 'Could not create the action item. Please try again.' };
        }

        return {
          success: true,
          action_item: {
            id: data.id,
            title: data.title,
            category: data.category,
            priority: data.priority,
            due_date: data.due_date,
            goal_id: data.goal_id,
          },
          message: `Action item "${title}" created.`,
        };
      } catch (err) {
        console.error('[tool:create_action_item] unexpected error:', err);
        return { error: 'Something went wrong creating the action item. Please try again.' };
      }
    },
  };
}
