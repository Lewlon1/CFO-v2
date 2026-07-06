import { z } from 'zod';
import type { ToolContext } from './types';
import { getPrimaryGoal } from '@/lib/goals/primary-goal';

// Server-computed month-vs-goal reconciliation — the arithmetic ban in
// BASE_PERSONA has no dedicated tool for "did this month cover the goal",
// so a chat turn answering that question mixed frames itself: subtracting
// an all-inclusive total_spending figure from a post-fixed-costs budget
// figure double-counts fixed costs (e.g. "$2,900 target" / "$833 short" when
// the month's own snapshot said $967.50 surplus). This tool reads the
// month's own already-correct surplus_deficit (income minus ALL spending,
// computed once in monthly-snapshot.ts) and compares it straight against
// the goal's already-correct monthly_required_saving — no frame-mixing, no
// arithmetic left for the model to get wrong.
export function createCompareMonthToGoalTool(ctx: ToolContext) {
  return {
    description:
      "Compare a specific month's actual income/spending against a goal's monthly requirement — use this whenever the user asks something like \"did January cover my goal\", \"was I on track last month\", or \"how does March compare to what my goal needs\". Returns a verdict (covered / short) computed server-side; never subtract a budget figure from a spending figure yourself to answer this.",
    inputSchema: z.object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe('YYYY-MM. Omit for the most recent month with a snapshot.'),
      goal_id: z
        .string()
        .uuid()
        .optional()
        .describe("Optional. Omit for the user's primary active goal."),
    }),
    execute: async ({ month, goal_id }: { month?: string; goal_id?: string }) => {
      try {
        let resolvedGoalId = goal_id;
        let goalRow: {
          id: string;
          name: string;
          monthly_required_saving: number | null;
          currency: string | null;
        } | null = null;

        if (!resolvedGoalId) {
          const primary = await getPrimaryGoal(ctx.supabase, ctx.userId);
          if (!primary) {
            return { error: 'No active goal is set up for this user yet.' };
          }
          resolvedGoalId = primary.id;
          goalRow = {
            id: primary.id,
            name: primary.name,
            monthly_required_saving: primary.monthly_required_saving,
            currency: null,
          };
        } else {
          const { data: goal, error: goalError } = await ctx.supabase
            .from('goals')
            .select('id, name, monthly_required_saving, currency')
            .eq('id', resolvedGoalId)
            .eq('user_id', ctx.userId)
            .is('deleted_at', null)
            .maybeSingle();
          if (goalError) {
            console.error('[tool:compare_month_to_goal] goal read failed:', goalError);
            return { error: 'Could not look up that goal. Please try again.' };
          }
          if (!goal) {
            return { error: 'No goal found with that id for this user.' };
          }
          goalRow = goal;
        }

        let snapshotQuery = ctx.supabase
          .from('monthly_snapshots')
          .select('month, total_income, total_spending, surplus_deficit, total_fixed_costs, total_discretionary')
          .eq('user_id', ctx.userId);
        snapshotQuery = month
          ? snapshotQuery.eq('month', `${month}-01`)
          : snapshotQuery.order('month', { ascending: false }).limit(1);
        const { data: snapshotRows, error: snapshotError } = await snapshotQuery;

        if (snapshotError) {
          console.error('[tool:compare_month_to_goal] snapshot read failed:', snapshotError);
          return { error: 'Could not look up that month. Please try again.' };
        }
        const snapshot = snapshotRows?.[0];
        if (!snapshot) {
          return {
            error: 'no_snapshot',
            message: month
              ? `No spending data on file for ${month}.`
              : 'No monthly spending data on file yet.',
          };
        }

        const income = snapshot.total_income != null ? Number(snapshot.total_income) : null;
        const totalSpending =
          snapshot.total_spending != null ? Number(snapshot.total_spending) : null;
        // The ONE surplus figure for this month — income minus ALL spending,
        // computed once in monthly-snapshot.ts. Never re-derive this by
        // subtracting a different tool's budget figure from total_spending.
        const surplus = snapshot.surplus_deficit != null ? Number(snapshot.surplus_deficit) : null;
        const fixedCosts =
          snapshot.total_fixed_costs != null ? Number(snapshot.total_fixed_costs) : null;
        const discretionarySpending =
          snapshot.total_discretionary != null ? Number(snapshot.total_discretionary) : null;

        const monthlyRequired = goalRow.monthly_required_saving;
        let verdict: 'covered' | 'short' | 'no_goal_pace' = 'no_goal_pace';
        let gapAmount: number | null = null;
        if (surplus != null && monthlyRequired != null) {
          verdict = surplus >= monthlyRequired ? 'covered' : 'short';
          gapAmount = verdict === 'short' ? Math.round((monthlyRequired - surplus) * 100) / 100 : null;
        }

        return {
          success: true,
          month: (snapshot.month as string).slice(0, 7),
          currency: goalRow.currency ?? ctx.currency,
          income,
          total_spending: totalSpending,
          fixed_costs: fixedCosts,
          discretionary_spending: discretionarySpending,
          surplus,
          goal_id: goalRow.id,
          goal_name: goalRow.name,
          monthly_required_saving: monthlyRequired,
          verdict,
          gap_amount: gapAmount,
        };
      } catch (err) {
        console.error('[tool:compare_month_to_goal] unexpected error:', err);
        return { error: 'Something went wrong comparing that month to the goal. Please try again.' };
      }
    },
  };
}
