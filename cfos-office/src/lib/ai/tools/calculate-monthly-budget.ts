import { z } from 'zod';
import type { ToolContext } from './types';
import { reconcileFixedCosts } from '@/lib/analytics/reconcile-fixed-costs';

export function createCalculateMonthlyBudgetTool(ctx: ToolContext) {
  return {
    description:
      'Calculate the user\'s monthly budget: income minus fixed costs = discretionary budget. Use when the user asks "what\'s my budget", "how much can I spend", "what\'s left after bills", or when you need to contextualise a spending number against their income.',
    inputSchema: z.object({
      include_partner_contribution: z
        .boolean()
        .optional()
        .describe('Whether to include partner contribution in income. Default true if partner_monthly_contribution exists.'),
    }),
    execute: async ({ include_partner_contribution }: { include_partner_contribution?: boolean }) => {
      try {
        // Fetch profile for income data
        const { data: profile, error: profileError } = await ctx.supabase
          .from('user_profiles')
          .select('net_monthly_income, gross_salary, partner_monthly_contribution')
          .eq('id', ctx.userId)
          .single();

        if (profileError) {
          console.error('[tool:calculate_monthly_budget] profile error:', profileError);
          return { error: 'Could not fetch profile data. Please try again.' };
        }

        const netIncome = profile?.net_monthly_income ? Number(profile.net_monthly_income) : null;

        if (!netIncome) {
          return {
            error: 'missing_field',
            field: 'net_monthly_income',
            message: 'Monthly take-home income has not been provided yet.',
            suggestion: 'Use request_structured_input to ask for their monthly net income (currency_amount type).',
          };
        }

        // Fixed costs: use the canonical reconcile — the same source the First
        // Read's free-cash-flow headline derives from — so "fixed costs" means
        // ONE thing app-wide. This INCLUDES rent (a profile field the old path
        // fetched but never summed), excludes dismissed rows, and dedupes
        // declared/detected + case-variant duplicates. The old path summed
        // recurring_expenses raw and omitted rent, which is exactly why this
        // tool's surplus (€446) couldn't reconcile with the Read's free cash
        // flow (€1,233 = income − rent − bills).
        const reconciled = await reconcileFixedCosts(ctx.supabase, ctx.userId);
        const totalFixedCosts = reconciled.totalFixedCostsMonthly;
        const fixedItems = reconciled.items
          .filter((item) => !item.superseded)
          .map((item) => ({
            name: item.label,
            amount: item.amount,
            frequency: item.cadence,
            monthly_equivalent: Math.round(item.monthly_equivalent * 100) / 100,
          }));

        const partnerContribution =
          include_partner_contribution !== false && profile?.partner_monthly_contribution
            ? Number(profile.partner_monthly_contribution)
            : 0;

        const totalIncome = netIncome + partnerContribution;
        const discretionary = totalIncome - totalFixedCosts;

        // Get average actual discretionary spending (last 3 months)
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const since = threeMonthsAgo.toISOString().slice(0, 10);

        const { data: recentTxns } = await ctx.supabase
          .from('transactions')
          .select('amount')
          .eq('user_id', ctx.userId)
          .lt('amount', 0)
          .eq('is_recurring', false)
          .gte('date', since);

        let avgMonthlyDiscretionary: number | null = null;
        let surplusDeficit: number | null = null;

        if (recentTxns && recentTxns.length > 0) {
          const totalDiscretionarySpend = recentTxns.reduce(
            (sum, t) => sum + Math.abs(Number(t.amount)),
            0
          );
          avgMonthlyDiscretionary = Math.round((totalDiscretionarySpend / 3) * 100) / 100;
          surplusDeficit = Math.round((discretionary - avgMonthlyDiscretionary) * 100) / 100;
        }

        return {
          net_monthly_income: netIncome,
          gross_salary: profile?.gross_salary ? Number(profile.gross_salary) : null,
          partner_contribution: partnerContribution > 0 ? partnerContribution : null,
          total_income: Math.round(totalIncome * 100) / 100,
          fixed_costs: {
            total: Math.round(totalFixedCosts * 100) / 100,
            items: fixedItems.slice(0, 15), // cap for token budget
          },
          discretionary_budget: Math.round(discretionary * 100) / 100,
          avg_monthly_discretionary_spend: avgMonthlyDiscretionary,
          surplus_deficit: surplusDeficit,
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:calculate_monthly_budget] unexpected error:', err);
        return { error: 'Something went wrong calculating your budget. Please try again.' };
      }
    },
  };
}
