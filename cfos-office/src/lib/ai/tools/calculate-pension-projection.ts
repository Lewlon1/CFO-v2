import { z } from 'zod';
import type { ToolContext } from './types';

// Map age_range strings (from question-registry.ts) to a midpoint age.
function ageRangeToMidpoint(range: string | null | undefined): number | null {
  if (!range) return null;
  switch (range) {
    case '18-25': return 22;
    case '26-30': return 28;
    case '31-35': return 33;
    case '36-40': return 38;
    case '41-50': return 45;
    case '50+': return 55;
    default: {
      // Try parsing as a numeric "X-Y" range
      const m = range.match(/^(\d+)-(\d+)$/);
      if (m) return Math.round((Number(m[1]) + Number(m[2])) / 2);
      const single = Number(range);
      if (!Number.isNaN(single)) return single;
      return null;
    }
  }
}

function projectPot(opts: {
  initial: number;
  monthlyContribution: number;
  monthlyRate: number;
  months: number;
}) {
  const { initial, monthlyContribution, monthlyRate, months } = opts;
  let fvContrib: number;
  if (monthlyRate === 0) {
    fvContrib = monthlyContribution * months;
  } else {
    fvContrib = monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
  }
  const fvInitial = initial * Math.pow(1 + monthlyRate, months);
  return fvContrib + fvInitial;
}

export function createCalculatePensionProjectionTool(ctx: ToolContext) {
  return {
    description: `Project pension pot value at retirement based on current contributions and assumed growth rate.

WHEN TO CALL: When the user asks about retirement, pension projections, or whether their pension contributions are enough.

VALID FIELDS:
- asset_id: string — optional. Specific pension asset. If omitted, projects across ALL pension assets combined.
- retirement_age: number — optional. Default 67.
- annual_growth_rate_pct: number — optional. Default 5 (nominal, before inflation).
- contribution_override_monthly: number — optional. Model a different contribution level.
- include_employer: boolean — optional. Default true.

RETURNS: Projected pot at retirement, total contributions, total growth, projected annual income (4% withdrawal rule), year-by-year breakdown, and 4 scenarios (current / +2% / +5% / override).

If pension or age data is missing, returns a missing-field error so you can ask the user.`,
    inputSchema: z.object({
      asset_id: z.string().uuid().optional(),
      retirement_age: z.number().int().min(40).max(90).optional(),
      annual_growth_rate_pct: z.number().min(0).max(20).optional(),
      contribution_override_monthly: z.number().min(0).optional(),
      include_employer: z.boolean().optional(),
    }),
    execute: async (params: {
      asset_id?: string;
      retirement_age?: number;
      annual_growth_rate_pct?: number;
      contribution_override_monthly?: number;
      include_employer?: boolean;
    }) => {
      try {
        const includeEmployer = params.include_employer !== false;
        const annualGrowthPct = params.annual_growth_rate_pct ?? 5;
        const monthlyRate = annualGrowthPct / 100 / 12;

        // Load pensions
        const pensionQuery = ctx.supabase
          .from('assets')
          .select('*')
          .eq('user_id', ctx.userId)
          .eq('asset_type', 'pension');

        const { data: pensions, error: pensionErr } = params.asset_id
          ? await pensionQuery.eq('id', params.asset_id)
          : await pensionQuery;

        if (pensionErr) {
          console.error('[tool:calculate_pension_projection] pension fetch error:', pensionErr);
          return { error: 'Could not look up your pensions. Please try again.' };
        }
        if (!pensions || pensions.length === 0) {
          return {
            error: 'missing_field',
            field: 'pension',
            message:
              "I don't have any pension information yet. Tell me about your pension — provider, current pot value, and how much you contribute — and I can run a projection.",
          };
        }

        const totalPot = pensions.reduce((s, p) => s + (Number(p.current_value) || 0), 0);
        if (totalPot <= 0) {
          return {
            error: 'missing_field',
            field: 'current_value',
            message: "I have your pension recorded but no current pot value. What's the current balance?",
          };
        }

        // Load profile for age + income
        const { data: profile } = await ctx.supabase
          .from('user_profiles')
          .select('age_range, net_monthly_income')
          .eq('id', ctx.userId)
          .maybeSingle();

        const currentAge = ageRangeToMidpoint(profile?.age_range);
        if (currentAge == null) {
          return {
            error: 'missing_field',
            field: 'age_range',
            message:
              "I need to know your rough age to project this. What age range are you in (e.g. 26-30, 31-35)?",
          };
        }

        const retirementAge = params.retirement_age ?? 67;
        const yearsToRetirement = retirementAge - currentAge;
        if (yearsToRetirement <= 0) {
          return {
            scenario: 'pension_projection',
            note: `Based on your age range, you're at or past retirement age (${retirementAge}).`,
            current_pot: totalPot,
            current_age: currentAge,
            currency: ctx.currency,
          };
        }

        const months = yearsToRetirement * 12;
        const netIncome = profile?.net_monthly_income ? Number(profile.net_monthly_income) : null;

        // Compute current contribution from pension details (sum across all pensions)
        let currentContribution = 0;
        let employerContributionTotal = 0;
        let employeeContributionTotal = 0;
        for (const p of pensions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const details = (p.details ?? {}) as Record<string, any>;
          const empPct = Number(details.employee_contribution_pct) || 0;
          const employerPct = Number(details.employer_contribution_pct) || 0;
          if (netIncome) {
            employeeContributionTotal += netIncome * (empPct / 100);
            employerContributionTotal += netIncome * (employerPct / 100);
          }
        }
        currentContribution = employeeContributionTotal + (includeEmployer ? employerContributionTotal : 0);

        // If no contribution info and no override, run a "no contribution" projection
        const monthlyContributionCurrent = params.contribution_override_monthly ?? currentContribution;

        // Build scenarios
        function buildScenario(label: string, monthlyContribution: number) {
          const finalPot = projectPot({
            initial: totalPot,
            monthlyContribution,
            monthlyRate,
            months,
          });
          const totalContributed = monthlyContribution * months;
          const totalGrowth = finalPot - totalPot - totalContributed;
          return {
            label,
            monthly_contribution: Math.round(monthlyContribution * 100) / 100,
            projected_pot: Math.round(finalPot),
            projected_annual_income: Math.round(finalPot * 0.04),
            total_contributed: Math.round(totalContributed),
            total_growth: Math.round(totalGrowth),
          };
        }

        const scenarios: ReturnType<typeof buildScenario>[] = [
          buildScenario('current', monthlyContributionCurrent),
        ];

        // +2% / +5% only meaningful when we know income to scale by
        if (netIncome) {
          const plus2 = monthlyContributionCurrent + netIncome * 0.02;
          const plus5 = monthlyContributionCurrent + netIncome * 0.05;
          scenarios.push(buildScenario('plus_2pct', plus2));
          scenarios.push(buildScenario('plus_5pct', plus5));
        }

        if (params.contribution_override_monthly != null) {
          scenarios.push(buildScenario('override', params.contribution_override_monthly));
        }

        // Year-by-year breakdown for the current scenario
        const yearlyBreakdown: Array<{
          year: number;
          age: number;
          total_value: number;
          total_contributed: number;
          growth: number;
        }> = [];
        for (let y = 1; y <= yearsToRetirement; y++) {
          const m = y * 12;
          const fv = projectPot({
            initial: totalPot,
            monthlyContribution: monthlyContributionCurrent,
            monthlyRate,
            months: m,
          });
          const contributed = monthlyContributionCurrent * m;
          yearlyBreakdown.push({
            year: y,
            age: currentAge + y,
            total_value: Math.round(fv),
            total_contributed: Math.round(contributed),
            growth: Math.round(fv - totalPot - contributed),
          });
        }

        return {
          scenario: 'pension_projection',
          current_pot: Math.round(totalPot),
          current_age: currentAge,
          retirement_age: retirementAge,
          years_to_retirement: yearsToRetirement,
          annual_growth_rate_pct: annualGrowthPct,
          monthly_contribution_current: Math.round(monthlyContributionCurrent * 100) / 100,
          monthly_contribution_breakdown: {
            employee: Math.round(employeeContributionTotal * 100) / 100,
            employer: Math.round(employerContributionTotal * 100) / 100,
            include_employer: includeEmployer,
          },
          scenarios,
          yearly_breakdown: yearlyBreakdown,
          currency: ctx.currency,
          disclaimer:
            'Projections assume constant nominal growth and current contributions. Actual returns vary; this does not account for inflation, tax, or fees.',
        };
      } catch (err) {
        console.error('[tool:calculate_pension_projection] unexpected error:', err);
        return { error: 'Something went wrong projecting your pension. Please try again.' };
      }
    },
  };
}
