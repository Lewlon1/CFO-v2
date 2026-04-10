import { z } from 'zod';
import type { ToolContext } from './types';
import { loadCurrentBudget, loadAverageDiscretionary } from './helpers';

export function createCreateGoalTool(ctx: ToolContext) {
  return {
    description:
      'Create a savings goal for the user. Use when the user wants to set a financial target — e.g. emergency fund, house deposit, big purchase, or any non-trip savings goal. Confirm the goal details with the user before calling. For trip-related goals, use plan_trip instead.',
    inputSchema: z.object({
      name: z.string().max(200).describe('Goal name, e.g. "Emergency fund" or "House deposit"'),
      description: z.string().max(500).optional().describe('Additional context'),
      target_amount: z.number().positive().describe('Target savings amount'),
      current_amount: z.number().min(0).optional().describe('Amount already saved (default 0)'),
      target_date: z
        .string()
        .optional()
        .describe('Target date in YYYY-MM-DD format, if the user has one'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
    }),
    execute: async ({
      name,
      description,
      target_amount,
      current_amount,
      target_date,
      priority,
    }: {
      name: string;
      description?: string;
      target_amount: number;
      current_amount?: number;
      target_date?: string;
      priority?: string;
    }) => {
      try {
        const saved = current_amount ?? 0;
        const remaining = target_amount - saved;

        // Compute monthly required saving if we have a target date
        let monthlySaving: number | null = null;
        if (target_date) {
          const now = new Date();
          const target = new Date(target_date);
          const monthsLeft =
            (target.getFullYear() - now.getFullYear()) * 12 +
            (target.getMonth() - now.getMonth());
          if (monthsLeft > 0) {
            monthlySaving = Math.round(remaining / monthsLeft);
          }
        }

        // Check feasibility against current surplus
        let onTrack: boolean | null = null;
        if (monthlySaving != null) {
          const [budget, avgDiscretionary] = await Promise.all([
            loadCurrentBudget(ctx),
            loadAverageDiscretionary(ctx),
          ]);

          if (budget.netIncome != null) {
            const totalIncome = budget.netIncome + budget.partnerContribution;
            const discretionary = avgDiscretionary ?? 0;
            const surplus = totalIncome - budget.fixedCosts - discretionary;
            onTrack = surplus >= monthlySaving;
          }
        }

        const { data, error } = await ctx.supabase
          .from('goals')
          .insert({
            user_id: ctx.userId,
            name,
            description: description || null,
            target_amount: Math.round(target_amount),
            current_amount: Math.round(saved),
            target_date: target_date || null,
            monthly_required_saving: monthlySaving,
            on_track: onTrack,
            priority: priority || 'medium',
            status: 'active',
          })
          .select('id, name, target_amount, current_amount, target_date, monthly_required_saving, on_track')
          .single();

        if (error) {
          console.error('[tool:create_goal] DB error:', error);
          return { error: 'Could not create the goal. Please try again.' };
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
