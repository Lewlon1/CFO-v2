/**
 * Lever derivation for the first Read.
 *
 * A lever is a structured next step the CFO can put in front of the user. The
 * code computes the magnitude (currency, months-saved) so the LLM never does
 * arithmetic — it just frames numbers it's handed.
 *
 * Two priority categories:
 *   1. `supply_input` blocker — a required input to the goal math is null. This
 *      is the headline finding for users in the Spain situation (active goal,
 *      no income on file). Once the user supplies the field, the gap can be
 *      sized.
 *   2. `cut` lever — a controllable recurring expense whose suggested 20% trim
 *      maps to a months-saved delta on the active goal. Only emitted when all
 *      pace inputs are populated.
 *
 * `shift` / `reallocate` are deferred to a follow-up pass. The brief allows
 * narrow starting scope.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadCurrentBudget,
  loadAverageDiscretionary,
  loadActiveGoals,
  toMonthlyEquivalent,
} from '@/lib/ai/tools/helpers';
import type { ToolContext } from '@/lib/ai/tools/types';

export type Lever =
  | {
      type: 'cut';
      category: string;
      currentMonthly: number;
      suggestedCut: number;
      /** Whole months sooner the active goal lands if the cut is sustained. Null when pace inputs are incomplete. */
      goalImpactMonths: number | null;
      goalId: string;
    }
  | { type: 'shift'; category: string; rationale: 'timing' | 'context'; goalId?: string }
  | { type: 'reallocate'; from: string; to: string; amount: number; goalId: string }
  | {
      type: 'supply_input';
      field: 'net_monthly_income' | 'target_amount' | 'target_date';
      /** Plain-English description of what unlocks when the user supplies the field. */
      unlocks: string;
      /** The active goal name — gives the LLM something concrete to point at. */
      goalName: string;
    };

export type LeverPackage = {
  /** All derived levers, with `blocker` first if present. */
  levers: Lever[];
  /** The single highest-priority `supply_input` lever, or null if every required pace input is populated. */
  blocker: Lever | null;
};

type ActiveGoalRow = {
  id: string;
  name: string;
  target_amount: number | null;
  current_amount: number | null;
  target_date: string | null;
};

type Budget = Awaited<ReturnType<typeof loadCurrentBudget>>;

// Minimal ToolContext for the helper calls — only `supabase` and `userId` are
// read by loadCurrentBudget / loadActiveGoals / loadAverageDiscretionary.
function makeMinimalCtx(supabase: SupabaseClient, userId: string, currency: string): ToolContext {
  return { supabase, userId, conversationId: '', currency };
}

export async function deriveLevers(args: {
  supabase: SupabaseClient;
  userId: string;
  currency?: string;
}): Promise<LeverPackage> {
  const ctx = makeMinimalCtx(args.supabase, args.userId, args.currency ?? 'GBP');

  const [goals, budget] = await Promise.all([
    loadActiveGoals(ctx),
    loadCurrentBudget(ctx),
  ]);

  const activeGoal = (goals[0] as ActiveGoalRow | undefined) ?? null;
  if (!activeGoal) {
    return { levers: [], blocker: null };
  }

  const blocker = detectBlocker(activeGoal, budget);
  const cutLever = await deriveCutLever(ctx, activeGoal, budget);

  const levers: Lever[] = [];
  if (blocker) levers.push(blocker);
  if (cutLever) levers.push(cutLever);

  return { levers, blocker };
}

/**
 * Returns the highest-priority `supply_input` lever or null. Priority order:
 * net_monthly_income (gates `on_track` even if everything else is set) >
 * target_date (gates `monthly_required_saving`) > target_amount.
 *
 * Matches the hard blockers identified in `pace.ts`: `target_date` and
 * `user_profiles.net_monthly_income` are the inputs that make the math return
 * null.
 */
export function detectBlocker(goal: ActiveGoalRow, budget: Budget): Lever | null {
  if (budget.netIncome == null) {
    return {
      type: 'supply_input',
      field: 'net_monthly_income',
      goalName: goal.name,
      unlocks: `sizing the monthly gap toward ${goal.name}`,
    };
  }
  if (goal.target_date == null) {
    return {
      type: 'supply_input',
      field: 'target_date',
      goalName: goal.name,
      unlocks: `the monthly pace needed to land ${goal.name} on time`,
    };
  }
  if (goal.target_amount == null) {
    return {
      type: 'supply_input',
      field: 'target_amount',
      goalName: goal.name,
      unlocks: `the per-month requirement for ${goal.name}`,
    };
  }
  return null;
}

async function deriveCutLever(
  ctx: ToolContext,
  goal: ActiveGoalRow,
  budget: Budget,
): Promise<Lever | null> {
  const { data: rows } = await ctx.supabase
    .from('recurring_expenses')
    .select('name, amount, frequency, category_id, status')
    .eq('user_id', ctx.userId)
    .is('deleted_at', null);
  if (!rows || rows.length === 0) return null;

  const candidates = rows
    .filter((r) => (r as { status: string | null }).status !== 'cancelled')
    .map((r) => {
      const row = r as { name: string; amount: number | string; frequency: string; category_id: string | null };
      return {
        name: row.name,
        category: row.category_id ?? row.name,
        monthly: toMonthlyEquivalent(Number(row.amount), row.frequency),
      };
    })
    // Rent/housing isn't a recurring "bill to trim" — it's the user's home.
    .filter((c) => !/(rent|housing|mortgage)/i.test(c.category) && !/(rent|housing|mortgage)/i.test(c.name))
    .sort((a, b) => b.monthly - a.monthly);

  if (candidates.length === 0) return null;
  const top = candidates[0];
  // Too small to matter — sub-£10 trims aren't a meaningful lever.
  if (top.monthly < 10) return null;

  const suggestedCut = Math.round(top.monthly * 0.20);

  const goalImpactMonths = await computeGoalImpactMonths(ctx, goal, budget, suggestedCut);

  return {
    type: 'cut',
    category: top.category,
    currentMonthly: Math.round(top.monthly),
    suggestedCut,
    goalImpactMonths,
    goalId: goal.id,
  };
}

/**
 * Counterfactual: how many whole months sooner does the active goal land if
 * the user has `extraMonthly` extra surplus from now on? Returns null when
 * any of the inputs needed for the comparison are missing.
 *
 * Conservative: floors to whole months, clamps at 0. Doesn't compound or
 * model inflation — it's an order-of-magnitude pointer, not a projection.
 */
async function computeGoalImpactMonths(
  ctx: ToolContext,
  goal: ActiveGoalRow,
  budget: Budget,
  extraMonthly: number,
): Promise<number | null> {
  if (goal.target_amount == null || budget.netIncome == null) return null;

  const remaining = Number(goal.target_amount) - Number(goal.current_amount ?? 0);
  if (remaining <= 0) return null;

  const avgDiscretionary = (await loadAverageDiscretionary(ctx)) ?? 0;
  const totalIncome = budget.netIncome + budget.partnerContribution;
  const currentSurplus = totalIncome - budget.fixedCosts - avgDiscretionary;
  if (currentSurplus <= 0) return null;

  const monthsCurrent = remaining / currentSurplus;
  const monthsWithCut = remaining / (currentSurplus + extraMonthly);
  const delta = monthsCurrent - monthsWithCut;
  return Math.max(0, Math.floor(delta));
}
