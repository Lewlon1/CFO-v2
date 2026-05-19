import { z } from 'zod';
import type { ToolContext } from './types';
import { computePaceAndOnTrack } from '@/lib/goals/pace';
import { logContribution } from '@/lib/goals/contributions';

export function createCreateGoalTool(ctx: ToolContext) {
  return {
    description:
      'Create a savings goal for the user. Use when the user wants to set a financial target — e.g. emergency fund, house deposit, big purchase, or any non-event savings goal. Confirm the goal details with the user before calling. For trips, weddings, gifts, or other time-bound events, use plan_event instead.',
    inputSchema: z.object({
      name: z.string().max(200).describe('Goal name, e.g. "Emergency fund" or "House deposit"'),
      description: z.string().max(500).optional().describe('Additional context'),
      target_amount: z.number().positive().describe('Target savings amount'),
      current_amount: z.number().min(0).optional().describe('Amount already saved (default 0)'),
      target_date: z
        .string()
        .optional()
        .refine(
          (val) => {
            if (!val) return true
            const target = new Date(val)
            if (Number.isNaN(target.getTime())) return false
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            return target.getTime() > today.getTime()
          },
          { message: 'target_date must be a valid date in the future (YYYY-MM-DD)' },
        )
        .describe('Target date in YYYY-MM-DD format, must be in the future'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
      type: z
        .enum(['debt_clearance', 'savings', 'investment', 'general'])
        .optional()
        .describe(
          'Goal classification: debt_clearance for paying down debt; savings for emergency funds, deposits, trips, big purchases; investment for pension/portfolio/long-term wealth; general otherwise. Pick the closest fit.',
        ),
    }),
    execute: async ({
      name,
      description,
      target_amount,
      current_amount,
      target_date,
      priority,
      type,
    }: {
      name: string;
      description?: string;
      target_amount: number;
      current_amount?: number;
      target_date?: string;
      priority?: string;
      type?: 'debt_clearance' | 'savings' | 'investment' | 'general';
    }) => {
      try {
        const saved = current_amount ?? 0;

        const pace = await computePaceAndOnTrack(ctx, {
          current_amount: saved,
          target_amount,
          target_date: target_date ?? null,
        });

        const { data, error } = await ctx.supabase
          .from('goals')
          .insert({
            user_id: ctx.userId,
            name,
            description: description || null,
            target_amount: Math.round(target_amount),
            current_amount: Math.round(saved),
            target_date: target_date || null,
            monthly_required_saving: pace.monthly_required_saving,
            on_track: pace.on_track,
            priority: priority || 'medium',
            type: type || 'general',
            status: 'active',
            currency: ctx.currency,
          })
          .select('id, name, target_amount, current_amount, target_date, monthly_required_saving, on_track, currency')
          .single();

        if (error) {
          console.error('[tool:create_goal] DB error:', error);
          return { error: 'Could not create the goal. Please try again.' };
        }

        // Seed contribution row — the immutable starting point. Keeps the
        // invariant current_amount = SUM(contributions) post-recompute.
        // Failure here is logged but not fatal: the goal row already has a
        // correct current_amount, and the defensive guard in the recompute
        // SQL function protects it from being zeroed on the next pass.
        if (saved > 0) {
          try {
            await logContribution(ctx.supabase, ctx.userId, {
              goalId: data.id,
              amount: Math.round(saved),
              kind: 'seed',
              note: 'Starting amount when goal was created',
            });
          } catch (seedErr) {
            console.error('[tool:create_goal] seed contribution failed:', seedErr);
          }
        }

        return {
          success: true,
          goal: data,
          message: `Goal "${name}" created — target ${ctx.currency} ${Math.round(target_amount).toLocaleString()}.`,
        };
      } catch (err) {
        console.error('[tool:create_goal] unexpected error:', err);
        return { error: 'Something went wrong creating the goal. Please try again.' };
      }
    },
  };
}
