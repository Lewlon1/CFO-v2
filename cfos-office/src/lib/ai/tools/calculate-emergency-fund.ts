import { z } from 'zod';
import type { ToolContext } from './types';
import { toMonthlyEquivalent } from './helpers';

export function createCalculateEmergencyFundTool(ctx: ToolContext) {
  return {
    description: `Assess how many months of essential spending the user's accessible savings would cover.

WHEN TO CALL: When the user asks about emergency funds, financial safety nets, how much they should keep in savings, or during goal setting.

No parameters required — uses existing balance sheet and spending data.

RETURNS: Accessible savings total, monthly essential spend (with source), months covered, recommended range (3-6 months), gap to minimum and to comfortable.

Returns months_covered: null with a note when no spending data exists yet.`,
    inputSchema: z.object({}),
    execute: async () => {
      try {
        // 1. Sum accessible assets
        const { data: assets, error: assetErr } = await ctx.supabase
          .from('assets')
          .select('current_value, is_accessible')
          .eq('user_id', ctx.userId);

        if (assetErr) {
          console.error('[tool:calculate_emergency_fund] assets fetch error:', assetErr);
          return { error: 'Could not look up your assets. Please try again.' };
        }

        const accessibleSavings = (assets || [])
          .filter((a) => a.is_accessible)
          .reduce((sum, a) => sum + (Number(a.current_value) || 0), 0);

        if (accessibleSavings <= 0) {
          return {
            error: 'missing_field',
            field: 'accessible_assets',
            message:
              "I don't have any accessible savings recorded yet. Tell me about your savings or current account balance and I can run this calculation.",
          };
        }

        // 2. Determine monthly essentials
        // Primary: latest monthly_snapshot foundation spend
        const { data: latestSnapshot } = await ctx.supabase
          .from('monthly_snapshots')
          .select('spending_by_value_category, total_spending')
          .eq('user_id', ctx.userId)
          .order('month', { ascending: false })
          .limit(1)
          .maybeSingle();

        let monthlyEssentials: number | null = null;
        let essentialsSource: 'foundation_spending' | 'recurring_expenses' | 'spending_proxy' | null = null;
        let essentialsNote: string | null = null;

        if (latestSnapshot?.spending_by_value_category) {
          const byVc = latestSnapshot.spending_by_value_category as Record<string, number>;
          const foundation = Number(byVc.foundation) || 0;
          if (foundation > 0) {
            monthlyEssentials = foundation;
            essentialsSource = 'foundation_spending';
          }
        }

        // Fallback 1: recurring expenses (mostly essentials)
        if (monthlyEssentials == null) {
          const { data: recurring } = await ctx.supabase
            .from('recurring_expenses')
            .select('amount, frequency')
            .eq('user_id', ctx.userId);

          if (recurring && recurring.length > 0) {
            const recurringMonthly = recurring.reduce(
              (sum, r) => sum + toMonthlyEquivalent(Number(r.amount) || 0, r.frequency),
              0
            );
            if (recurringMonthly > 0) {
              monthlyEssentials = recurringMonthly;
              essentialsSource = 'recurring_expenses';
              essentialsNote =
                'Based on your recurring expenses (bills, rent, subscriptions). Categorise some transactions as Foundation for a more accurate figure.';
            }
          }
        }

        // Fallback 2: rough proxy from total spending
        if (monthlyEssentials == null && latestSnapshot?.total_spending) {
          monthlyEssentials = Number(latestSnapshot.total_spending) * 0.7;
          essentialsSource = 'spending_proxy';
          essentialsNote =
            'Rough estimate at 70% of total spending. Categorise some transactions as Foundation for a more accurate figure.';
        }

        if (monthlyEssentials == null || monthlyEssentials <= 0) {
          return {
            accessible_savings: Math.round(accessibleSavings * 100) / 100,
            monthly_essentials: null,
            months_covered: null,
            note: "I need at least one month of spending data to calculate how long your savings would last. Upload a recent bank statement and I can run this.",
            currency: ctx.currency,
          };
        }

        const monthsCovered = accessibleSavings / monthlyEssentials;
        const recommendedMinimum = monthlyEssentials * 3;
        const recommendedComfortable = monthlyEssentials * 6;
        const gapToMinimum = Math.max(0, recommendedMinimum - accessibleSavings);
        const gapToComfortable = Math.max(0, recommendedComfortable - accessibleSavings);

        return {
          accessible_savings: Math.round(accessibleSavings * 100) / 100,
          monthly_essentials: Math.round(monthlyEssentials * 100) / 100,
          months_covered: Math.round(monthsCovered * 10) / 10,
          recommended_minimum: Math.round(recommendedMinimum * 100) / 100,
          recommended_comfortable: Math.round(recommendedComfortable * 100) / 100,
          gap_to_minimum: Math.round(gapToMinimum * 100) / 100,
          gap_to_comfortable: Math.round(gapToComfortable * 100) / 100,
          essentials_source: essentialsSource,
          essentials_note: essentialsNote,
          status:
            monthsCovered < 1
              ? 'critical'
              : monthsCovered < 3
                ? 'thin'
                : monthsCovered < 6
                  ? 'adequate'
                  : 'strong',
          currency: ctx.currency,
        };
      } catch (err) {
        console.error('[tool:calculate_emergency_fund] unexpected error:', err);
        return { error: 'Something went wrong calculating that. Please try again.' };
      }
    },
  };
}
