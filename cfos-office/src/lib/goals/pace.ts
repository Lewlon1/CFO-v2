import type { ToolContext } from '@/lib/ai/tools/types';
import { loadCurrentBudget, loadAverageDiscretionary } from '@/lib/ai/tools/helpers';

export interface PaceInput {
  current_amount: number;
  target_amount: number;
  target_date: string | null;
}

export interface PaceResult {
  monthly_required_saving: number | null;
  on_track: boolean | null;
}

// Extracted from create-goal.ts lines 50-77 so create_goal, plan_trip, and the
// recompute engine all use the same formula. Drift between creators and the
// recompute would mean a goal could say "on track" at creation and "off track"
// after the first login with nothing else changed.
export async function computePaceAndOnTrack(
  ctx: ToolContext,
  input: PaceInput,
): Promise<PaceResult> {
  const remaining = input.target_amount - input.current_amount;

  let monthly_required_saving: number | null = null;
  if (input.target_date) {
    const now = new Date();
    const target = new Date(input.target_date);
    const monthsLeft =
      (target.getFullYear() - now.getFullYear()) * 12 +
      (target.getMonth() - now.getMonth());
    if (monthsLeft > 0) {
      monthly_required_saving = Math.round(remaining / monthsLeft);
    }
  }

  let on_track: boolean | null = null;
  if (monthly_required_saving != null) {
    const [budget, avgDiscretionary] = await Promise.all([
      loadCurrentBudget(ctx),
      loadAverageDiscretionary(ctx),
    ]);

    if (budget.netIncome != null) {
      const totalIncome = budget.netIncome + budget.partnerContribution;
      const discretionary = avgDiscretionary ?? 0;
      const surplus = totalIncome - budget.fixedCosts - discretionary;
      on_track = surplus >= monthly_required_saving;
    }
  }

  return { monthly_required_saving, on_track };
}
