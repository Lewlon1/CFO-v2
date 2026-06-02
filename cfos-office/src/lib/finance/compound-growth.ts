// Shared compound-growth maths. Single source of truth for future-value and
// required-monthly-contribution calculations used by goal pacing, the
// investment-growth scenario tool, and the pension projection tool.
//
// All functions assume a constant nominal annual return compounded monthly,
// contributions made monthly. They are pure — no I/O, no rounding (callers
// round for display). The r=0 case degrades to linear, matching the prior
// growth-blind behaviour for non-investment goals.

/**
 * Future value of an initial lump sum plus a monthly contribution series.
 *
 * FV = PV·(1+r)^n + PMT·((1+r)^n − 1)/r        (r > 0)
 * FV = PV + PMT·n                              (r = 0)
 *
 * where r = annualRatePct/100/12 and n = months.
 */
export function futureValueSeries(opts: {
  initialAmount: number;
  monthlyContribution: number;
  annualRatePct: number;
  months: number;
}): number {
  const { initialAmount, monthlyContribution, annualRatePct, months } = opts;
  if (months <= 0) return initialAmount;
  const r = annualRatePct / 100 / 12;
  if (r === 0) {
    return initialAmount + monthlyContribution * months;
  }
  const growth = Math.pow(1 + r, months);
  const fvInitial = initialAmount * growth;
  const fvContrib = monthlyContribution * ((growth - 1) / r);
  return fvInitial + fvContrib;
}

/**
 * Monthly contribution required to reach `targetAmount` from `currentAmount`
 * over `months`, accounting for compound growth at `annualRatePct`.
 *
 * Solve FV equation for PMT:
 *   PMT = (FV − PV·(1+r)^n) · r / ((1+r)^n − 1)   (r > 0)
 *   PMT = (FV − PV) / n                           (r = 0, linear)
 *
 * Returns 0 when the seed already compounds past the target (no further
 * contribution needed), and null when months <= 0 (no horizon to solve over).
 */
export function requiredMonthlyForTarget(opts: {
  targetAmount: number;
  currentAmount: number;
  annualRatePct: number;
  months: number;
}): number | null {
  const { targetAmount, currentAmount, annualRatePct, months } = opts;
  if (months <= 0) return null;
  const r = annualRatePct / 100 / 12;
  if (r === 0) {
    return Math.max(0, (targetAmount - currentAmount) / months);
  }
  const growth = Math.pow(1 + r, months);
  const fvOfSeed = currentAmount * growth;
  const gap = targetAmount - fvOfSeed;
  if (gap <= 0) return 0; // seed alone compounds past target
  return (gap * r) / (growth - 1);
}

/** Default rate range surfaced to the user for investment goals (conservative / moderate / optimistic). */
export const INVESTMENT_RATES_PCT = [4, 7, 10] as const;

/**
 * Default nominal rate used for the stored scalar `monthly_required_saving`
 * and on_track on investment goals. 7% matches model-scenario's default so
 * the goal record, the Read, and the what-if tool agree.
 */
export const INVESTMENT_DEFAULT_RATE_PCT = 7;

/**
 * The required-monthly figure across a band of return rates, for surfacing the
 * compounding concept ("~€X/mo at 4%, ~€Y at 7%, ~€Z at 10%").
 */
export function requiredMonthlyBand(opts: {
  targetAmount: number;
  currentAmount: number;
  months: number;
  ratesPct?: readonly number[];
}): Array<{ ratePct: number; monthly: number | null }> {
  const rates = opts.ratesPct ?? INVESTMENT_RATES_PCT;
  return rates.map((ratePct) => ({
    ratePct,
    monthly: requiredMonthlyForTarget({
      targetAmount: opts.targetAmount,
      currentAmount: opts.currentAmount,
      annualRatePct: ratePct,
      months: opts.months,
    }),
  }));
}
