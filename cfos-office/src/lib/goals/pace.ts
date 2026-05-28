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

/**
 * Day-precise month count between two dates. If the target day-of-month hasn't
 * been reached yet relative to the start day, we're one month short — so
 * "5 years from May 28 to May 27" is 59 months, not 60.
 *
 * Uses UTC throughout to avoid timezone drift: YYYY-MM-DD target_date strings
 * parse as UTC midnight, and we treat `now` the same way.
 */
export function monthsBetween(from: Date, to: Date): number {
  const yearDelta = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  let months = yearDelta * 12 + monthDelta;
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

/**
 * Add a year/month duration to today's UTC date, returning YYYY-MM-DD. Used
 * by create_goal to compute target_date from a user-stated duration ("over 5
 * years") server-side, so the LLM never has to do date arithmetic.
 */
export function targetDateFromDuration(input: {
  durationYears?: number | null;
  durationMonths?: number | null;
  from?: Date;
}): string {
  const from = input.from ?? new Date();
  const result = new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  ));
  if (input.durationYears) {
    result.setUTCFullYear(result.getUTCFullYear() + input.durationYears);
  }
  if (input.durationMonths) {
    result.setUTCMonth(result.getUTCMonth() + input.durationMonths);
  }
  return result.toISOString().slice(0, 10);
}

// Extracted from create-goal.ts lines 50-77 so create_goal, plan_event, and the
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
    const monthsLeft = monthsBetween(now, target);
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
