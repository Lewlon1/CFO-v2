import type { ToolContext } from './types';

export function toMonthlyEquivalent(amount: number, frequency: string): number {
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

export async function loadCurrentBudget(ctx: ToolContext) {
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

  return {
    netIncome,
    partnerContribution,
    fixedCosts,
    monthlyRent,
    grossSalary: profile?.gross_salary ? Number(profile.gross_salary) : null,
  };
}

export async function loadAverageDiscretionary(ctx: ToolContext): Promise<number | null> {
  const { data: snapshots } = await ctx.supabase
    .from('monthly_snapshots')
    .select('total_discretionary')
    .eq('user_id', ctx.userId)
    .order('month', { ascending: false })
    .limit(3);

  if (!snapshots || snapshots.length === 0) return null;

  const total = snapshots.reduce((sum, s) => sum + (Number(s.total_discretionary) || 0), 0);
  return total / snapshots.length;
}

export async function loadActiveGoals(ctx: ToolContext) {
  const { data } = await ctx.supabase
    .from('goals')
    .select('*')
    .eq('user_id', ctx.userId)
    .eq('status', 'active');

  return data || [];
}

export async function loadSavingsBalance(ctx: ToolContext): Promise<number> {
  const { data } = await ctx.supabase
    .from('accounts')
    .select('current_balance')
    .eq('user_id', ctx.userId)
    .in('type', ['savings', 'investment']);

  if (!data || data.length === 0) return 0;
  return data.reduce((sum, a) => sum + (Number(a.current_balance) || 0), 0);
}
