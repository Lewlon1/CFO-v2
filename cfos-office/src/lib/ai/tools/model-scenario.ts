import { z } from 'zod';
import type { ToolContext } from './types';
import {
  loadCurrentBudget,
  loadAverageDiscretionary,
  loadActiveGoals,
  loadSavingsBalance,
} from './helpers';

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

async function modelChildren(ctx: ToolContext, params: Record<string, unknown>) {
  const childCount = typeof params.child_count === 'number' ? params.child_count : 1;
  const yearsFromNow = typeof params.years_from_now === 'number' ? params.years_from_now : 0;

  const [budget, avgDiscretionary, goals] = await Promise.all([
    loadCurrentBudget(ctx),
    loadAverageDiscretionary(ctx),
    loadActiveGoals(ctx),
  ]);

  if (!budget.netIncome) {
    return {
      error: 'missing_field',
      field: 'net_monthly_income',
      message: 'Income not yet provided. Cannot model this scenario without knowing current income.',
      suggestion: 'Use request_structured_input to ask for monthly net income first.',
    };
  }

  // Barcelona / Spain average monthly costs per child (sourced from INE / consumer surveys)
  const costBreakdown = {
    childcare: 350,
    food: 150,
    clothing: 50,
    healthcare: 30,
    activities: 80,
    misc: 40,
  };

  const monthlyPerChild = Object.values(costBreakdown).reduce((a, b) => a + b, 0);
  const totalMonthlyIncrease = monthlyPerChild * childCount;

  const currentSurplus = budget.netIncome + budget.partnerContribution - budget.fixedCosts
    - (avgDiscretionary ?? 0);
  const newSurplus = currentSurplus - totalMonthlyIncrease;

  // Goal impact
  const goalImpact = goals.map(g => {
    const required = g.monthly_required_saving ? Number(g.monthly_required_saving) : 0;
    if (!required) return { goal: g.name, impact: 'no_change' as const };
    const canStillFund = newSurplus >= required;
    return {
      goal: g.name,
      current_monthly_saving: required,
      still_feasible: canStillFund,
      new_months_to_goal: canStillFund && newSurplus > 0
        ? Math.ceil((Number(g.target_amount || 0) - Number(g.current_amount || 0)) / newSurplus)
        : null,
    };
  });

  // Partner income reduction sub-scenarios
  const partnerScenarios = budget.partnerContribution > 0 ? {
    partner_stops_working: {
      new_surplus: Math.round(currentSurplus - totalMonthlyIncrease - budget.partnerContribution),
      feasible: (currentSurplus - totalMonthlyIncrease - budget.partnerContribution) > 0,
    },
    partner_part_time: {
      assumed_partner_income: Math.round(budget.partnerContribution * 0.5),
      new_surplus: Math.round(currentSurplus - totalMonthlyIncrease - (budget.partnerContribution * 0.5)),
      feasible: (currentSurplus - totalMonthlyIncrease - (budget.partnerContribution * 0.5)) > 0,
    },
  } : null;

  return {
    scenario: 'children',
    child_count: childCount,
    years_from_now: yearsFromNow,
    cost_breakdown: costBreakdown,
    estimated_monthly_cost_per_child: monthlyPerChild,
    total_monthly_increase: totalMonthlyIncrease,
    current_surplus: Math.round(currentSurplus),
    new_surplus: Math.round(newSurplus),
    surplus_still_positive: newSurplus > 0,
    goal_impact: goalImpact,
    partner_scenarios: partnerScenarios,
    currency: ctx.currency,
    note: 'Cost estimates are Barcelona averages. Actual costs vary by childcare choice, neighbourhood, and lifestyle.',
  };
}

async function modelCareerChange(ctx: ToolContext, params: Record<string, unknown>) {
  const newNetMonthly = typeof params.new_net_monthly === 'number' ? params.new_net_monthly : undefined;
  const transitionMonths = typeof params.transition_months === 'number' ? params.transition_months : 3;

  if (!newNetMonthly) {
    return { error: 'Please provide the expected new net monthly income (new_net_monthly).' };
  }

  const [budget, avgDiscretionary, savingsBalance, goals] = await Promise.all([
    loadCurrentBudget(ctx),
    loadAverageDiscretionary(ctx),
    loadSavingsBalance(ctx),
    loadActiveGoals(ctx),
  ]);

  if (!budget.netIncome) {
    return {
      error: 'missing_field',
      field: 'net_monthly_income',
      message: 'Income not yet provided. Cannot model a career change without knowing current income.',
      suggestion: 'Use request_structured_input to ask for monthly net income first.',
    };
  }

  const currentNet = budget.netIncome;
  const incomeChange = newNetMonthly - currentNet;
  const incomeChangePct = (incomeChange / currentNet) * 100;

  // Transition burn rate
  const monthlyBurn = budget.fixedCosts + (avgDiscretionary ?? 0);
  const transitionCost = transitionMonths * monthlyBurn;
  const canSurviveTransition = savingsBalance >= transitionCost;
  const monthsOfRunway = monthlyBurn > 0 ? Math.floor(savingsBalance / monthlyBurn) : 0;

  // Steady state
  const currentSurplus = currentNet + budget.partnerContribution - budget.fixedCosts
    - (avgDiscretionary ?? 0);
  const newSurplus = newNetMonthly + budget.partnerContribution - budget.fixedCosts
    - (avgDiscretionary ?? 0);

  // Goal impact
  const goalImpact = goals.map(g => {
    const required = g.monthly_required_saving ? Number(g.monthly_required_saving) : 0;
    if (!required) return { goal: g.name, impact: 'no_change' as const };
    const canStillFund = newSurplus >= required;
    const remaining = Number(g.target_amount || 0) - Number(g.current_amount || 0);
    return {
      goal: g.name,
      current_monthly_saving: required,
      still_feasible: canStillFund,
      new_months_to_goal: canStillFund && newSurplus > 0
        ? Math.ceil(remaining / newSurplus)
        : null,
    };
  });

  return {
    scenario: 'career_change',
    current_net_monthly: Math.round(currentNet),
    new_net_monthly: Math.round(newNetMonthly),
    income_change: Math.round(incomeChange),
    income_change_pct: Math.round(incomeChangePct * 10) / 10,
    transition: {
      months_with_no_income: transitionMonths,
      monthly_burn_rate: Math.round(monthlyBurn),
      total_transition_cost: Math.round(transitionCost),
      current_savings: Math.round(savingsBalance),
      can_survive_transition: canSurviveTransition,
      months_of_runway: monthsOfRunway,
      shortfall: canSurviveTransition ? 0 : Math.round(transitionCost - savingsBalance),
    },
    steady_state: {
      current_surplus: Math.round(currentSurplus),
      new_surplus: Math.round(newSurplus),
      surplus_change: Math.round(newSurplus - currentSurplus),
    },
    goal_impact: goalImpact,
    currency: ctx.currency,
  };
}

async function modelInvestmentGrowth(ctx: ToolContext, params: Record<string, unknown>) {
  const monthlyContribution = typeof params.monthly_contribution === 'number' ? params.monthly_contribution : undefined;
  const annualReturnPct = typeof params.annual_return_pct === 'number' ? params.annual_return_pct : 7;
  const years = typeof params.years === 'number' ? params.years : 10;
  const initialAmount = typeof params.initial_amount === 'number' ? params.initial_amount : 0;

  if (!monthlyContribution) {
    return { error: 'Please provide a monthly contribution amount (monthly_contribution).' };
  }

  const monthlyRate = annualReturnPct / 100 / 12;
  const totalMonths = years * 12;

  // Future value of a series (monthly contributions) + future value of lump sum
  let futureValueContributions: number;
  if (monthlyRate === 0) {
    futureValueContributions = monthlyContribution * totalMonths;
  } else {
    futureValueContributions = monthlyContribution * ((Math.pow(1 + monthlyRate, totalMonths) - 1) / monthlyRate);
  }

  const futureValueInitial = initialAmount * Math.pow(1 + monthlyRate, totalMonths);
  const totalFutureValue = futureValueContributions + futureValueInitial;
  const totalContributed = (monthlyContribution * totalMonths) + initialAmount;
  const totalGrowth = totalFutureValue - totalContributed;

  // Year-by-year breakdown for charts
  const yearlyBreakdown = [];
  for (let y = 1; y <= years; y++) {
    const m = y * 12;
    let fvContrib: number;
    if (monthlyRate === 0) {
      fvContrib = monthlyContribution * m;
    } else {
      fvContrib = monthlyContribution * ((Math.pow(1 + monthlyRate, m) - 1) / monthlyRate);
    }
    const fvInitial = initialAmount * Math.pow(1 + monthlyRate, m);
    const totalAtYear = fvContrib + fvInitial;
    const contributedAtYear = (monthlyContribution * m) + initialAmount;
    yearlyBreakdown.push({
      year: y,
      total_value: Math.round(totalAtYear),
      total_contributed: Math.round(contributedAtYear),
      growth: Math.round(totalAtYear - contributedAtYear),
    });
  }

  // Feasibility check against current surplus
  const [budget, avgDiscretionary] = await Promise.all([
    loadCurrentBudget(ctx),
    loadAverageDiscretionary(ctx),
  ]);

  const currentSurplus = budget.netIncome
    ? budget.netIncome + budget.partnerContribution - budget.fixedCosts - (avgDiscretionary ?? 0)
    : null;
  const feasible = currentSurplus != null ? monthlyContribution <= currentSurplus : null;

  return {
    scenario: 'investment_growth',
    monthly_contribution: monthlyContribution,
    initial_amount: initialAmount,
    annual_return_pct: annualReturnPct,
    years,
    result: {
      total_future_value: Math.round(totalFutureValue),
      total_contributed: Math.round(totalContributed),
      total_growth: Math.round(totalGrowth),
      growth_pct: totalContributed > 0 ? Math.round((totalGrowth / totalContributed) * 100) : 0,
    },
    yearly_breakdown: yearlyBreakdown,
    feasibility: currentSurplus != null ? {
      current_monthly_surplus: Math.round(currentSurplus),
      contribution_affordable: feasible,
      surplus_after_contribution: Math.round(currentSurplus - monthlyContribution),
    } : null,
    currency: ctx.currency,
    disclaimer: 'Projections assume a constant annual return and do not account for inflation, taxes, or market volatility. Actual returns will vary.',
  };
}

export function createModelScenarioTool(ctx: ToolContext) {
  return {
    description:
      'Model a financial what-if scenario and show the impact on the user\'s budget. Use when the user says "what if I got a raise", "what if I cut spending on X", "what would a mortgage look like", "what if I had kids", "what if I changed careers", "how would my investments grow", or any hypothetical financial question.\n\nScenario types and their params:\n- salary_increase: { new_net_monthly?: number, increase_pct?: number, increase_amount?: number }\n- expense_reduction: { category_slug: string, reduction_pct: number }\n- property_purchase: { price: number, deposit_pct?: number (default 20), rate_pct?: number (default 3.5), years?: number (default 25) }\n- children: { child_count?: number (default 1), years_from_now?: number (default 0) }\n- career_change: { new_net_monthly: number, transition_months?: number (default 3) }\n- investment_growth: { monthly_contribution: number, annual_return_pct?: number (default 7), years?: number (default 10), initial_amount?: number (default 0) }',
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
            return await modelChildren(ctx, params);
          case 'career_change':
            return await modelCareerChange(ctx, params);
          case 'investment_growth':
            return await modelInvestmentGrowth(ctx, params);
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
