import { z } from 'zod';
import type { ToolContext } from './types';

export function createCreateActionItemTool(ctx: ToolContext) {
  return {
    description:
      'Create a tracked action item for the user. Use when the conversation produces a concrete next step, e.g. "I should cancel that gym membership", "switch electricity provider", or "set up a savings transfer". Confirm the action with the user before calling this tool.',
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
    }),
    execute: async ({
      title,
      description,
      category,
      priority,
      due_date,
    }: {
      title: string;
      description?: string;
      category: string;
      priority?: string;
      due_date?: string;
    }) => {
      try {
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
            status: 'pending',
          })
          .select('id, title, category, priority, due_date')
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
