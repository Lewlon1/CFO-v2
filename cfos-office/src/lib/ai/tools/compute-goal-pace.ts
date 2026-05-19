import { z } from 'zod';
import type { ToolContext } from './types';

// Returns the pre-computed pace for a goal (monthly required saving, months
// remaining, on-track flag). The CFO calls this instead of dividing target by
// months in chat — the arithmetic ban in BASE_PERSONA points here.
//
// All values are read from `goals` (no division performed in the tool body
// either). `monthly_required_saving` is populated at goal creation via
// computePaceAndOnTrack() and refreshed on each contribution by
// recompute_goal_current_amount(), so it's always current.
export function createComputeGoalPaceTool(ctx: ToolContext) {
  return {
    description:
      "Get the pace for a specific goal — monthly amount needed, months remaining, and whether the user is on track. Use this when the user asks any 'how much per month' / 'how long will it take' style question about a goal. Returns numbers from the system; do not compute these yourself.",
    inputSchema: z.object({
      goal_id: z
        .string()
        .uuid()
        .describe(
          "The UUID of the goal to compute pace for. If the user references a goal by name, resolve the UUID from their active goals first.",
        ),
    }),
    execute: async ({ goal_id }: { goal_id: string }) => {
      try {
        const { data: goal, error } = await ctx.supabase
          .from('goals')
          .select(
            'id, name, target_amount, current_amount, target_date, monthly_required_saving, on_track, currency, status',
          )
          .eq('id', goal_id)
          .eq('user_id', ctx.userId)
          .is('deleted_at', null)
          .maybeSingle();

        if (error) {
          console.error('[tool:compute_goal_pace] DB error:', error);
          return { error: 'Could not look up that goal. Please try again.' };
        }
        if (!goal) {
          return { error: 'No goal found with that id for this user.' };
        }

        const currency = goal.currency ?? ctx.currency;
        const remaining = Math.max(0, (goal.target_amount ?? 0) - (goal.current_amount ?? 0));

        let months_remaining: number | null = null;
        if (goal.target_date) {
          const now = new Date();
          const target = new Date(goal.target_date);
          const diffMonths =
            (target.getFullYear() - now.getFullYear()) * 12 +
            (target.getMonth() - now.getMonth());
          months_remaining = diffMonths > 0 ? diffMonths : 0;
        }

        return {
          success: true,
          goal_id: goal.id,
          name: goal.name,
          currency,
          target_amount: goal.target_amount,
          current_amount: goal.current_amount,
          remaining_amount: remaining,
          target_date: goal.target_date,
          months_remaining,
          monthly_required_saving: goal.monthly_required_saving,
          on_track: goal.on_track,
          status: goal.status,
          needs_target_date: goal.target_date == null,
        };
      } catch (err) {
        console.error('[tool:compute_goal_pace] unexpected error:', err);
        return { error: 'Something went wrong computing goal pace. Please try again.' };
      }
    },
  };
}
