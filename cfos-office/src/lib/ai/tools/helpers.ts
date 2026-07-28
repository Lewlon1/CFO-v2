import type { ToolContext } from './types';
import { getFinancialPosition } from '@/lib/finance/financial-position';

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

/**
 * Thin wrapper over the unified financial-position module, kept for the
 * many chat tools that already destructure this shape. `fixedCosts` used to
 * be a raw sum of ALL recurring_expenses rows (no rent, no declared bills,
 * no status filter — dismissed rows counted) computed independently of
 * every other surplus calculation in the app; it now reads the same
 * reconciled total the First Read and calculate_monthly_budget use.
 */
export async function loadCurrentBudget(ctx: ToolContext) {
  const position = await getFinancialPosition(ctx.supabase, ctx.userId);
  return {
    netIncome: position.income != null ? position.income - position.partnerContribution : null,
    partnerContribution: position.partnerContribution,
    fixedCosts: position.fixedCostsMonthly,
    monthlyRent: position.monthlyRent,
    grossSalary: position.grossSalary,
  };
}

/**
 * Reads monthly_snapshots.total_discretionary via the unified module. Null
 * means "no observed history yet" — callers must NOT coerce this to 0; a
 * missing average is not the same fact as zero discretionary spend (that
 * conflation was the root cause behind the false "funded / spare cash"
 * figures — this column didn't exist for most of the app's life, so every
 * caller's `?? 0` silently modelled every user as spending nothing beyond
 * their fixed bills).
 */
export async function loadAverageDiscretionary(ctx: ToolContext): Promise<number | null> {
  const position = await getFinancialPosition(ctx.supabase, ctx.userId);
  return position.avgDiscretionaryMonthly;
}

/**
 * Ordered newest-first so `goals[0]` (how levers.ts picks "the" active goal)
 * agrees with `getActiveGoal` in compose-first-read.ts, which independently
 * queries `order('created_at', {ascending:false}).limit(1)` for the Read's
 * own goal. Before this ordering existed, a user with 2+ active goals could
 * have the lever engine and the Read narrating DIFFERENT goals — the
 * compose-time consistency assertion (Issue 1.4) compared numbers from two
 * goals as if they were one, either falsely flagging a mismatch or, worse,
 * passing by coincidence while the Read cited one goal's figures next to a
 * lever sized for another.
 */
export async function loadActiveGoals(ctx: ToolContext) {
  const { data } = await ctx.supabase
    .from('goals')
    .select('*')
    .eq('user_id', ctx.userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

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
