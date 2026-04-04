import { z } from 'zod';
import type { ToolContext } from './types';

function toMonthlyEquivalent(amount: number, frequency: string): number {
  switch (frequency) {
    case 'monthly': return amount;
    case 'bimonthly':
    case 'bi-monthly': return amount / 2;
    case 'quarterly': return amount / 3;
    case 'annual':
    case 'yearly': return amount / 12;
    default: return amount;
  }
}

async function loadCurrentBudget(ctx: ToolContext) {
  const [profileResult, recurringResult] = await Promise.all([
    ctx.supabase
      .from('user_profiles')
      .select('net_monthly_income, gross_salary, partner_monthly_contribution, monthly_rent')
      .eq('id', ctx.userId)
      .single(),
    ctx.supabase
      .from('recurring_expenses')
      .select('name, amount, frequency')
      .eq('user_id', ctx.userId),
  ]);

  const profile = profileResult.data;
  const recurring = recurringResult.data || [];

  const netIncome = profile?.net_monthly_income ? Number(profile.net_monthly_income) : null;
  const partnerContribution = profile?.partner_monthly_contribution
    ? Number(profile.partner_monthly_contribution)
    : 0;
  const monthlyRent = profile?.monthly_rent ? Number(profile.monthly_rent) : null;

  const fixedCosts = recurring.reduce(
    (sum, r) => sum + toMonthlyEquivalent(Number(r.amount), r.frequency),
    0
  );

  return { netIncome, partnerContribution, fixedCosts, monthlyRent, grossSalary: profile?.gross_salary ? Number(profile.gross_salary) : null };
}

async function modelSalaryIncrease(ctx: ToolContext, params: Record<string, unknown>) {
  const budget = await loadCurrentBudget(ctx);

  if (!budget.netIncome) {
    return {
      error: 'missing_field',
      field: 'net_monthly_income',
      message: 'Income not yet provided. Cannot model a salary change without knowing current income.',
      suggestion: 'Use request_structured_input to ask for monthly net income first.',
    };
  }

  let newNetMonthly: number;
  if (typeof params.new_net_monthly === 'number') {
    newNetMonthly = params.new_net_monthly;
  } else if (typeof params.increase_pct === 'number') {
    newNetMonthly = budget.netIncome * (1 + (params.increase_pct as number) / 100);
  } else if (typeof params.increase_amount === 'number') {
    newNetMonthly = budget.netIncome + (params.increase_amount as number);
  } else {
    return { error: 'Please provide new_net_monthly, increase_pct, or increase_amount in the params.' };
  }

  const currentTotal = budget.netIncome + budget.partnerContribution;
  const newTotal = newNetMonthly + budget.partnerContribution;
  const currentDiscretionary = currentTotal - budget.fixedCosts;
  const newDiscretionary = newTotal - budget.fixedCosts;
  const monthlyDelta = newDiscretionary - currentDiscretionary;

  return {
    scenario: 'salary_increase',
    current: {
      net_income: budget.netIncome,
      fixed_costs: Math.round(budget.fixedCosts * 100) / 100,
      discretionary: Math.round(currentDiscretionary * 100) / 100,
    },
    projected: {
      net_income: Math.round(newNetMonthly * 100) / 100,
      fixed_costs: Math.round(budget.fixedCosts * 100) / 100,
      discretionary: Math.round(newDiscretionary * 100) / 100,
    },
    impact: {
      monthly_change: Math.round(monthlyDelta * 100) / 100,
      annual_change: Math.round(monthlyDelta * 12 * 100) / 100,
    },
    currency: ctx.currency,
  };
}

async function modelExpenseReduction(ctx: ToolContext, params: Record<string, unknown>) {
  const categorySlug = params.category_slug as string;
  const reductionPct = params.reduction_pct as number;

  if (!categorySlug || typeof reductionPct !== 'number') {
    return { error: 'Please provide category_slug (string) and reduction_pct (number) in the params.' };
  }

  const budget = await loadCurrentBudget(ctx);

  // Get avg monthly spend for this category (last 3 months)
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const since = threeMonthsAgo.toISOString().slice(0, 10);

  const { data: txns } = await ctx.supabase
    .from('transactions')
    .select('amount')
    .eq('user_id', ctx.userId)
    .eq('category_id', categorySlug)
    .lt('amount', 0)
    .gte('date', since);

  if (!txns || txns.length === 0) {
    return { error: `No transactions found for category "${categorySlug}" in the last 3 months.` };
  }

  const totalSpend = txns.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const avgMonthly = totalSpend / 3;
  const targetMonthly = avgMonthly * (1 - reductionPct / 100);
  const monthlySaving = avgMonthly - targetMonthly;

  const currentDiscretionary = budget.netIncome
    ? budget.netIncome + budget.partnerContribution - budget.fixedCosts
    : null;
  const newDiscretionary = currentDiscretionary != null
    ? currentDiscretionary + monthlySaving
    : null;

  return {
    scenario: 'expense_reduction',
    category: categorySlug,
    reduction_pct: reductionPct,
    current_monthly_avg: Math.round(avgMonthly * 100) / 100,
    target_monthly: Math.round(targetMonthly * 100) / 100,
    monthly_saving: Math.round(monthlySaving * 100) / 100,
    annual_saving: Math.round(monthlySaving * 12 * 100) / 100,
    current_discretionary: currentDiscretionary != null ? Math.round(currentDiscretionary * 100) / 100 : null,
    new_discretionary: newDiscretionary != null ? Math.round(newDiscretionary * 100) / 100 : null,
    currency: ctx.currency,
  };
}

async function modelPropertyPurchase(ctx: ToolContext, params: Record<string, unknown>) {
  const price = params.price as number;
  if (typeof price !== 'number' || price <= 0) {
    return { error: 'Please provide a valid property price in the params.' };
  }

  const depositPct = (typeof params.deposit_pct === 'number' ? params.deposit_pct : 20) / 100;
  const annualRate = (typeof params.rate_pct === 'number' ? params.rate_pct : 3.5) / 100;
  const years = typeof params.years === 'number' ? params.years : 25;

  const depositAmount = price * depositPct;
  const mortgageAmount = price - depositAmount;
  const monthlyRate = annualRate / 12;
  const totalMonths = years * 12;

  // Standard amortization formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
  let monthlyPayment: number;
  if (monthlyRate === 0) {
    monthlyPayment = mortgageAmount / totalMonths;
  } else {
    const factor = Math.pow(1 + monthlyRate, totalMonths);
    monthlyPayment = mortgageAmount * (monthlyRate * factor) / (factor - 1);
  }

  const totalCost = monthlyPayment * totalMonths;
  const totalInterest = totalCost - mortgageAmount;

  const budget = await loadCurrentBudget(ctx);
  const vsCurrentRent = budget.monthlyRent != null
    ? Math.round((monthlyPayment - budget.monthlyRent) * 100) / 100
    : null;

  return {
    scenario: 'property_purchase',
    property_price: price,
    deposit: {
      percentage: depositPct * 100,
      amount: Math.round(depositAmount * 100) / 100,
    },
    mortgage: {
      amount: Math.round(mortgageAmount * 100) / 100,
      annual_rate_pct: annualRate * 100,
      term_years: years,
      monthly_payment: Math.round(monthlyPayment * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      total_interest: Math.round(totalInterest * 100) / 100,
    },
    vs_current_rent: vsCurrentRent,
    current_rent: budget.monthlyRent,
    currency: ctx.currency,
  };
}

export function createModelScenarioTool(ctx: ToolContext) {
  return {
    description:
      'Model a financial what-if scenario and show the impact on the user\'s budget. Use when the user says "what if I got a raise", "what if I cut spending on X", "what would a mortgage look like", or any hypothetical financial question.\n\nScenario types and their params:\n- salary_increase: { new_net_monthly?: number, increase_pct?: number, increase_amount?: number }\n- expense_reduction: { category_slug: string, reduction_pct: number }\n- property_purchase: { price: number, deposit_pct?: number (default 20), rate_pct?: number (default 3.5), years?: number (default 25) }\n- children, career_change, investment_growth: coming soon',
    inputSchema: z.object({
      scenario_type: z
        .enum(['salary_increase', 'property_purchase', 'children', 'career_change', 'investment_growth', 'expense_reduction'])
        .describe('Type of scenario to model'),
      params: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .describe('Scenario-specific parameters'),
    }),
    execute: async ({ scenario_type, params }: { scenario_type: string; params: Record<string, unknown> }) => {
      try {
        switch (scenario_type) {
          case 'salary_increase':
            return await modelSalaryIncrease(ctx, params);
          case 'expense_reduction':
            return await modelExpenseReduction(ctx, params);
          case 'property_purchase':
            return await modelPropertyPurchase(ctx, params);
          case 'children':
          case 'career_change':
          case 'investment_growth':
            return {
              error: `The ${scenario_type.replace('_', ' ')} scenario is coming soon. For now, you can model salary changes, expense reductions, and property purchases.`,
            };
          default:
            return { error: `Unknown scenario type: ${scenario_type}` };
        }
      } catch (err) {
        console.error('[tool:model_scenario] unexpected error:', err);
        return { error: 'Something went wrong modelling that scenario. Please try again.' };
      }
    },
  };
}
