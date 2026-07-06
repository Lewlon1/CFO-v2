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
} from '@/lib/ai/tools/helpers';
import type { ToolContext } from '@/lib/ai/tools/types';
import { DISCRETIONARY_CATEGORY_IDS, categoryLabel } from '@/lib/analytics/categories';
import type { SpendingBreakdown } from '@/lib/analytics/spending-breakdown';
import { requiredMonthlyBand } from '@/lib/finance/compound-growth';
import { monthsBetween } from '@/lib/goals/pace';

const DAYS_PER_MONTH = 30.44;
// A `cut` lever suggests trimming a quarter of a discretionary category — a
// meaningful but realistic ask, not "cut it out entirely".
const CUT_FRACTION = 0.25;

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
  | {
      type: 'accelerate';
      goalId: string;
      goalName: string;
      /** Spare cash each month BEYOND what the goal needs at plan (surplus − monthly_required). */
      surplusOverRequired: number;
      /**
       * Investment goals only: how much MORE per month the conservative (low-return)
       * stress case needs than the current surplus covers. 0 = covered even at the
       * stress rate; null = not an investment goal / not computable.
       */
      stressTestGap: number | null;
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
  /** Investment goals are paced with compound growth — gates the stress-test gap. */
  type?: string | null;
  /** Persisted pace verdict from pace.ts (compound-aware for investment goals). */
  on_track?: boolean | null;
  monthly_required_saving?: number | null;
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
  /** The cut lever's category + magnitude are read from this breakdown. */
  spendingBreakdown?: SpendingBreakdown | null;
  /** Window the breakdown totals cover, for the monthly-equivalent. Default 90. */
  windowDays?: number;
  /**
   * Actual months of data inside the window, floored at 1 — the monthly-equivalent
   * divides by THIS, not by `windowDays`. Dividing a 1-month upload by the fixed
   * 90d window (≈2.96 months) understated every "/mo" figure ~3x (a real $362
   * shopping month surfaced as "$122 a month"). Falls back to windowDays/30.44
   * when omitted, so callers that genuinely have a full window are unaffected.
   */
  effectiveMonths?: number;
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

  const levers: Lever[] = [];
  if (blocker) levers.push(blocker);

  // When the goal is already funded at plan (on_track), don't manufacture a cut —
  // emit an `accelerate` lever instead, so the Read frames the real choice (direct
  // the spare cash, cover the stress case, or move to the next goal) rather than a
  // gap that doesn't exist. Only the not-funded path derives a cut.
  const accelerate = await deriveAccelerateLever(ctx, activeGoal, budget);
  if (accelerate) {
    levers.push(accelerate);
  } else {
    const cutLever = await deriveCutLever(
      ctx,
      activeGoal,
      budget,
      args.spendingBreakdown ?? null,
      args.windowDays ?? 90,
      args.effectiveMonths,
    );
    if (cutLever) levers.push(cutLever);
  }

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

/**
 * The cut lever names the user's biggest DISCRETIONARY category and a sized
 * trim — the SAME category the SPENDING BREAKDOWN leads on, so the Read's ONE
 * ACTION is coherent. It used to read the biggest `recurring_expenses` row,
 * which surfaced essentials you can't trim (council tax, water, energy) or a
 * variable transport line the recurring-detector misflagged as a "bill" (renfe),
 * then the Read stapled that tiny unrelated cut to whatever category the
 * breakdown named — "the one move that closes it" followed by a €6 renfe trim
 * against a €276 gap. Sourcing the cut from the discretionary breakdown fixes
 * both the bogus target and the contradiction. See SESSION-LOG.
 *
 * Essentials (rent, utilities, groceries, transport, health) are never cut
 * targets — see DISCRETIONARY_CATEGORY_IDS. Returns null when no discretionary
 * category clears a meaningful floor; the Read then frames the gap qualitatively.
 */
async function deriveCutLever(
  ctx: ToolContext,
  goal: ActiveGoalRow,
  budget: Budget,
  breakdown: SpendingBreakdown | null,
  windowDays: number,
  effectiveMonths?: number,
): Promise<Lever | null> {
  if (!breakdown || breakdown.top_categories.length === 0) return null;

  const biggest = breakdown.top_categories
    .filter((c) => DISCRETIONARY_CATEGORY_IDS.has(c.category.trim().toLowerCase()))
    .sort((a, b) => b.total - a.total)[0];
  if (!biggest) return null;

  // Divide by the ACTUAL data coverage, floored at one month so a sub-month
  // upload can't be extrapolated upward. Falling back to windowDays/30.44 keeps
  // full-window callers identical to before.
  const months =
    effectiveMonths != null
      ? Math.max(1, effectiveMonths)
      : Math.max(1, windowDays / DAYS_PER_MONTH);
  const monthly = biggest.total / months;
  // Sub-€25/mo categories aren't "the one move" — not worth leading the Read on.
  if (monthly < 25) return null;

  const suggestedCut = Math.round(monthly * CUT_FRACTION);
  if (suggestedCut < 10) return null;

  const goalImpactMonths = await computeGoalImpactMonths(ctx, goal, budget, suggestedCut);

  return {
    type: 'cut',
    category: categoryLabel(biggest.category),
    currentMonthly: Math.round(monthly),
    suggestedCut,
    goalImpactMonths,
    goalId: goal.id,
  };
}

/**
 * Monthly free cash: total income minus fixed costs minus average discretionary
 * spend. The ONE definition of surplus — pace.ts, the cut lever's impact, and the
 * accelerate gate must all agree (one source of truth). Null when income is absent.
 */
async function computeCurrentSurplus(
  ctx: ToolContext,
  budget: Budget,
): Promise<number | null> {
  if (budget.netIncome == null) return null;
  const avgDiscretionary = (await loadAverageDiscretionary(ctx)) ?? 0;
  const totalIncome = budget.netIncome + budget.partnerContribution;
  return totalIncome - budget.fixedCosts - avgDiscretionary;
}

/**
 * Emitted INSTEAD of a cut when the active goal is already funded at plan. The
 * magnitudes are the spare cash beyond what the goal needs and — for investment
 * goals — whether the conservative (low-return) stress case is also covered.
 *
 * Deliberately does NOT compute a naive "months sooner" off cash surplus: that
 * model ignores investment growth (the very thing that makes a retirement pot
 * on-track), so it would contradict pace.ts. Both magnitudes here are robust and
 * computed server-side; the LLM only frames them.
 */
async function deriveAccelerateLever(
  ctx: ToolContext,
  goal: ActiveGoalRow,
  budget: Budget,
): Promise<Lever | null> {
  const currentSurplus = await computeCurrentSurplus(ctx, budget);
  if (currentSurplus == null) return null;

  const monthlyRequired = goal.monthly_required_saving ?? null;

  // "Funded at plan": prefer the persisted on_track verdict (pace.ts computes it
  // compound-aware for investment goals); fall back to a live surplus-vs-required
  // comparison only when on_track hasn't been computed yet.
  const surplusCoversGoal =
    goal.on_track === true ||
    (goal.on_track == null && monthlyRequired != null && currentSurplus >= monthlyRequired);
  if (!surplusCoversGoal) return null;

  const surplusOverRequired = Math.round(currentSurplus - (monthlyRequired ?? 0));

  // Investment goals: is the conservative (low-return) stress case also covered?
  let stressTestGap: number | null = null;
  if (goal.type === 'investment' && goal.target_amount != null && goal.target_date != null) {
    const monthsLeft = monthsBetween(new Date(), new Date(goal.target_date));
    if (monthsLeft > 0) {
      const band = requiredMonthlyBand({
        targetAmount: goal.target_amount,
        currentAmount: goal.current_amount ?? 0,
        months: monthsLeft,
      });
      const conservative = band.reduce(
        (min, b) => (b.ratePct < min.ratePct ? b : min),
        band[0],
      );
      const requiredConservative = conservative?.monthly ?? null;
      if (requiredConservative != null) {
        stressTestGap = Math.max(0, Math.round(requiredConservative - currentSurplus));
      }
    }
  }

  return {
    type: 'accelerate',
    goalId: goal.id,
    goalName: goal.name,
    surplusOverRequired,
    stressTestGap,
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

  const currentSurplus = await computeCurrentSurplus(ctx, budget);
  if (currentSurplus == null || currentSurplus <= 0) return null;

  const monthsCurrent = remaining / currentSurplus;
  const monthsWithCut = remaining / (currentSurplus + extraMonthly);
  const delta = monthsCurrent - monthsWithCut;
  return Math.max(0, Math.floor(delta));
}
