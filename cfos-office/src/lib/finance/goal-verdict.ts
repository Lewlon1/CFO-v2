// Single source of truth for the goal verdict: "is this goal funded at plan,
// and by how much".
//
// Rule 2 — the system computes, the LLM interprets. Every OTHER number in a
// First Read is computed server-side and handed to the model verbatim; the
// verdict was the one exception, and models got it wrong in both directions:
// subtracting two monthly *requirements* from each other and calling the
// difference a shortfall, and picking the right pair but flipping the sign.
// Both Nova Pro and Claude Sonnet produced inversions, so it is not a
// model-strength problem — it is an "we asked the model to do arithmetic"
// problem. This module removes the arithmetic from the ask.
//
// The declared / skip-upload path already computed its verdict server-side
// (see DeclaredReadFacts.fundedAtPlan in compose-first-read.ts). This is that
// same pattern, extracted so the upload path and the validator share it
// (Rule 8 — one source of truth per fact).
//
// Pure: no DB, no I/O, `asOf` injected so tests are deterministic.

import {
  requiredMonthlyBand,
  INVESTMENT_DEFAULT_RATE_PCT,
} from '@/lib/finance/compound-growth';
import { monthsBetween } from '@/lib/goals/pace';

export interface GoalVerdictInput {
  goal: {
    type: string | null;
    target_amount: number | null;
    current_amount: number | null;
    target_date: string | null;
    monthly_required_saving: number | null;
  } | null;
  freeCashFlow: number | null;
  /** now — injected so tests are deterministic. */
  asOf: Date;
}

export interface GoalVerdict {
  /**
   * false when the PACE inputs are missing (no goal, no target date, horizon
   * elapsed, no requirement derivable) — nothing numeric about the goal may be
   * asserted at all. True does NOT imply a verdict exists: that additionally
   * needs free cash flow, and is signalled by `fundedAtPlan != null`.
   */
  computable: boolean;
  /** Free cash flow the verdict was computed against, rounded. Null when unknown. */
  freeCashFlow: number | null;
  /** Every monthly requirement figure offered (band values, or straight-line). */
  requirements: Array<{ ratePct: number | null; monthly: number }>;
  /** The requirement the Read plans around (the 7% case, or the straight-line figure). */
  planMonthly: number | null;
  planRatePct: number | null;
  /** The conservative stress case (lowest rate). Null for non-investment goals. */
  stressMonthly: number | null;
  stressRatePct: number | null;

  // ── The verdict itself — the numbers the model must quote, never derive ──
  /** freeCashFlow >= planMonthly. Null when free cash flow is unknown — the
   *  pace figures above are still real, but no verdict may be stated. */
  fundedAtPlan: boolean | null;
  /** freeCashFlow − planMonthly when funded; else null. */
  surplusAtPlan: number | null;
  /** planMonthly − freeCashFlow when NOT funded; else null. */
  shortfallAtPlan: number | null;
  /** freeCashFlow >= stressMonthly. Null when no stress case. */
  stressCovered: boolean | null;
  /** stressMonthly − freeCashFlow when the stress case is NOT covered; else null. */
  stressShortfall: number | null;
}

const NOT_COMPUTABLE: GoalVerdict = {
  computable: false,
  freeCashFlow: null,
  requirements: [],
  planMonthly: null,
  planRatePct: null,
  stressMonthly: null,
  stressRatePct: null,
  fundedAtPlan: null,
  surplusAtPlan: null,
  shortfallAtPlan: null,
  stressCovered: null,
  stressShortfall: null,
};

/**
 * Compute the goal verdict from the goal row and free cash flow.
 *
 * Mirrors the maths already in `deriveAccelerateLever` (analytics/levers.ts)
 * and `computePaceAndOnTrack` (goals/pace.ts): investment goals are paced with
 * compound growth across the 4/7/10% band, everything else straight-line off
 * the stored `monthly_required_saving`.
 *
 * Invariant: exactly one of `surplusAtPlan` / `shortfallAtPlan` is non-null
 * whenever `computable` is true. That is what makes the observed inversion
 * structurally impossible to express — there is no second number lying around
 * for the model to mistake for the gap.
 *
 * Every money figure is `Math.round`ed: the Read never shows cents, and the
 * validator compares against these rounded figures.
 */
export function computeGoalVerdict(input: GoalVerdictInput): GoalVerdict {
  const { goal, asOf } = input;
  if (goal == null) return NOT_COMPUTABLE;

  // Free cash flow gates the VERDICT, not the pace figures. The prompt renders
  // the rate band from `requirements` — so those must survive a null free cash
  // flow, or buildGoalSummary would have to compute the band a second time and
  // the two derivations could disagree (they did: two independent `new Date()`
  // calls put £985 in the band line and £948 in the verdict).
  const freeCashFlow = input.freeCashFlow == null ? null : Math.round(input.freeCashFlow);

  const monthsLeft =
    goal.target_date != null ? monthsBetween(asOf, new Date(goal.target_date)) : null;
  if (monthsLeft == null || monthsLeft <= 0) return NOT_COMPUTABLE;

  const requirements: GoalVerdict['requirements'] = [];
  let planMonthly: number | null = null;
  let planRatePct: number | null = null;
  let stressMonthly: number | null = null;
  let stressRatePct: number | null = null;

  if (goal.type === 'investment' && goal.target_amount != null) {
    const band = requiredMonthlyBand({
      targetAmount: goal.target_amount,
      currentAmount: goal.current_amount ?? 0,
      months: monthsLeft,
    });
    for (const b of band) {
      if (b.monthly != null) requirements.push({ ratePct: b.ratePct, monthly: Math.round(b.monthly) });
    }
    const plan = requirements.find((r) => r.ratePct === INVESTMENT_DEFAULT_RATE_PCT);
    if (plan == null) return NOT_COMPUTABLE;
    planMonthly = plan.monthly;
    planRatePct = plan.ratePct;
    // The stress case is the LOWEST rate in the band — the most conservative
    // return assumption, which demands the HIGHEST monthly contribution.
    const stress = requirements.reduce((min, r) =>
      (r.ratePct ?? Infinity) < (min.ratePct ?? Infinity) ? r : min,
    );
    // Only a genuinely different scenario is a stress test. If the band
    // collapsed to one entry, there is nothing to stress against.
    if (stress.ratePct !== planRatePct) {
      stressMonthly = stress.monthly;
      stressRatePct = stress.ratePct;
    }
  } else if (goal.monthly_required_saving != null) {
    planMonthly = Math.round(goal.monthly_required_saving);
    planRatePct = null;
    requirements.push({ ratePct: null, monthly: planMonthly });
  } else {
    return NOT_COMPUTABLE;
  }

  const pace = {
    computable: true as const,
    freeCashFlow,
    requirements,
    planMonthly,
    planRatePct,
    stressMonthly,
    stressRatePct,
  };

  // No free cash flow → real pace figures, no verdict. Every verdict field
  // stays null so a caller cannot mistake "unknown" for "not funded".
  if (freeCashFlow == null) {
    return {
      ...pace,
      fundedAtPlan: null,
      surplusAtPlan: null,
      shortfallAtPlan: null,
      stressCovered: null,
      stressShortfall: null,
    };
  }

  const fundedAtPlan = freeCashFlow >= planMonthly;

  return {
    ...pace,
    fundedAtPlan,
    // Exactly one of these is non-null — see the invariant above.
    surplusAtPlan: fundedAtPlan ? freeCashFlow - planMonthly : null,
    shortfallAtPlan: fundedAtPlan ? null : planMonthly - freeCashFlow,
    stressCovered: stressMonthly == null ? null : freeCashFlow >= stressMonthly,
    stressShortfall:
      stressMonthly != null && freeCashFlow < stressMonthly ? stressMonthly - freeCashFlow : null,
  };
}
