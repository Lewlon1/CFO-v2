import { z } from 'zod';
import type { ToolContext } from './types';
import { monthsBetween } from '@/lib/goals/pace';
import { requiredMonthlyBand } from '@/lib/finance/compound-growth';
import { getPrimaryGoal } from '@/lib/goals/primary-goal';

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
        .optional()
        .describe(
          "Optional. The UUID of a specific goal. Omit it for the user's primary active goal — the system resolves it server-side. You do not need to know or look up a goal's UUID to answer a pace question about their (usually only) goal.",
        ),
    }),
    execute: async ({ goal_id }: { goal_id?: string }) => {
      try {
        // Resolve the goal. With no id, use the canonical primary-active-goal
        // signal (getPrimaryGoal) so the CFO can answer "what's my goal pace?"
        // without ever being handed a UUID — the gap that made it deny goals it
        // had just created.
        let resolvedId = goal_id;
        if (!resolvedId) {
          const primary = await getPrimaryGoal(ctx.supabase, ctx.userId);
          if (!primary) {
            return { error: 'No active goal is set up for this user yet.' };
          }
          resolvedId = primary.id;
        }

        const { data: goal, error } = await ctx.supabase
          .from('goals')
          .select(
            'id, name, type, target_amount, current_amount, target_date, monthly_required_saving, on_track, currency, status',
          )
          .eq('id', resolvedId)
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
          const diffMonths = monthsBetween(new Date(), new Date(goal.target_date));
          months_remaining = diffMonths > 0 ? diffMonths : 0;
        }

        // Investment goals: also return the required-monthly across a band of
        // return rates so the CFO can explain compounding and show a range,
        // rather than presenting the single stored figure as the only truth.
        const growth_band =
          goal.type === 'investment' &&
          goal.target_amount != null &&
          months_remaining != null &&
          months_remaining > 0
            ? requiredMonthlyBand({
                targetAmount: goal.target_amount,
                currentAmount: goal.current_amount ?? 0,
                months: months_remaining,
              }).map((b) => ({ annual_return_pct: b.ratePct, monthly_required: b.monthly }))
            : null;

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
          monthly_required_basis: goal.type === 'investment' ? 'compound_growth' : 'straight_line',
          growth_rate_band: growth_band,
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
