import { z } from 'zod';
import type { ToolContext } from './types';
import { logContribution } from '@/lib/goals/contributions';

export function createLogContributionTool(ctx: ToolContext) {
  return {
    description:
      "Log a contribution the user made toward a specific savings goal. Call this when the user reports having put money toward — or pulled money out of — a named goal (e.g. \"I put €200 toward the Japan trip\", \"I added 500 to my emergency fund\", \"I had to take £100 out of the house deposit\"). A goal MUST be named — if the user mentions saving in general (\"I saved €300 this month\") without naming a goal, ask which goal it belongs to instead of calling this tool. Negative amounts are allowed for corrections or withdrawals. After the contribution is logged the system recomputes progress and returns the updated goal state, which you should reference in your reply using the specific numbers (current / target / percentage).",
    inputSchema: z.object({
      goal_id: z.string().uuid().describe(
        "The UUID of the goal this contribution applies to. Resolve goal names from the user's active goals before calling; if the user's reference is ambiguous, ask one clarifying question first instead of guessing.",
      ),
      amount: z
        .number()
        .refine((v) => v !== 0 && !Number.isNaN(v), {
          message: 'amount must be non-zero',
        })
        .describe(
          'Contribution amount in the user\'s primary currency. Positive for a deposit toward the goal, negative for a withdrawal or correction.',
        ),
      note: z.string().max(500).optional().describe(
        'Optional short note about the contribution (e.g. "tax refund", "moved from savings", "correction").',
      ),
    }),
    execute: async ({
      goal_id,
      amount,
      note,
    }: {
      goal_id: string;
      amount: number;
      note?: string;
    }) => {
      try {
        // Verify the goal belongs to this user and is active before writing.
        const { data: goal, error: lookupErr } = await ctx.supabase
          .from('goals')
          .select('id, name, status')
          .eq('id', goal_id)
          .eq('user_id', ctx.userId)
          .is('deleted_at', null)
          .maybeSingle();
        if (lookupErr) {
          console.error('[tool:log_contribution] goal lookup error:', lookupErr);
          return { error: 'Could not look up that goal. Please try again.' };
        }
        if (!goal) {
          return { error: 'No active goal found with that id for this user.' };
        }
        if (goal.status !== 'active') {
          return { error: `That goal is "${goal.status}", so contributions cannot be logged against it.` };
        }

        const result = await logContribution(ctx.supabase, ctx.userId, {
          goalId: goal_id,
          amount: Math.round(amount),
          note: note ?? null,
          kind: 'manual',
        });

        const target = result.goal.target_amount;
        const current = result.goal.current_amount;
        const pct = target > 0 ? Math.round((current / target) * 100) : 0;

        return {
          success: true,
          contribution: {
            id: result.contribution.id,
            amount: result.contribution.amount,
            note: result.contribution.note,
            logged_at: result.contribution.logged_at,
          },
          goal: {
            id: result.goal.id,
            name: goal.name,
            current_amount: current,
            target_amount: target,
            pct,
            monthly_required_saving: result.goal.monthly_required_saving,
            on_track: result.goal.on_track,
            is_overdue: result.goal.is_overdue,
          },
          message:
            amount >= 0
              ? `Logged ${ctx.currency} ${Math.round(amount).toLocaleString()} toward "${goal.name}" — now at ${ctx.currency} ${current.toLocaleString()} of ${ctx.currency} ${target.toLocaleString()} (${pct}%).`
              : `Logged ${ctx.currency} ${Math.round(amount).toLocaleString()} against "${goal.name}" — now at ${ctx.currency} ${current.toLocaleString()} of ${ctx.currency} ${target.toLocaleString()} (${pct}%).`,
        };
      } catch (err) {
        console.error('[tool:log_contribution] unexpected error:', err);
        return { error: 'Something went wrong logging that contribution. Please try again.' };
      }
    },
  };
}
