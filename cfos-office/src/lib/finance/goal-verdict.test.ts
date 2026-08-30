import { describe, it, expect } from 'vitest';
import { computeGoalVerdict, type GoalVerdictInput } from './goal-verdict';

// Deterministic "now". Every target_date below is a whole number of months
// away from this instant, so monthsBetween is exact and the band figures are
// reproducible.
const AS_OF = new Date('2026-01-15T00:00:00Z');
const IN_60_MONTHS = '2031-01-15';

/**
 * Target amount whose 4% (conservative-band) requirement is exactly
 * `monthly`/mo from a zero seed over `months`.
 *
 * Inverts requiredMonthlyForTarget: PMT = FV·r/((1+r)^n − 1), so
 * FV = PMT·((1+r)^n − 1)/r. Lets the regression rows below be stated in the
 * terms they were observed in ("needs £1,249/mo at 4%") rather than as a
 * back-solved target nobody can check.
 */
function targetFor4pctMonthly(monthly: number, months: number): number {
  const r = 4 / 100 / 12;
  return (monthly * (Math.pow(1 + r, months) - 1)) / r;
}

function investmentGoal(monthly4pct: number): GoalVerdictInput['goal'] {
  return {
    type: 'investment',
    target_amount: targetFor4pctMonthly(monthly4pct, 60),
    current_amount: 0,
    target_date: IN_60_MONTHS,
    monthly_required_saving: null,
  };
}

describe('computeGoalVerdict — the five observed inversions', () => {
  // Every row is a real Read that told a funded user they were short. The
  // model either subtracted two requirements from each other, or picked the
  // right pair and flipped the sign. Both models did it, which is why this
  // is computed server-side rather than prompted for.
  const rows: Array<{ model: string; fcf: number; needs4: number; surplusAt4: number }> = [
    { model: 'Nova Pro (£62 short)', fcf: 1470, needs4: 1249, surplusAt4: 221 },
    { model: 'Nova Pro (£33 short)', fcf: 3798, needs4: 2732, surplusAt4: 1066 },
    { model: 'Nova Pro (€300 short)', fcf: 820, needs4: 800, surplusAt4: 20 },
    { model: 'Nova Pro (£578 short)', fcf: 1422, needs4: 857, surplusAt4: 565 },
    { model: 'Claude Sonnet (£221 short)', fcf: 1470, needs4: 1249, surplusAt4: 221 },
  ];

  for (const row of rows) {
    it(`${row.model}: funded at plan, no shortfall anywhere`, () => {
      const verdict = computeGoalVerdict({
        goal: investmentGoal(row.needs4),
        freeCashFlow: row.fcf,
        asOf: AS_OF,
      });

      expect(verdict.computable).toBe(true);
      // The fixture really does reproduce the observed 4% requirement.
      expect(verdict.stressRatePct).toBe(4);
      expect(verdict.stressMonthly).toBe(row.needs4);

      expect(verdict.fundedAtPlan).toBe(true);
      expect(verdict.shortfallAtPlan).toBeNull();
      // Free cash clears even the conservative case, so nothing is short.
      expect(verdict.stressCovered).toBe(true);
      expect(verdict.stressShortfall).toBeNull();
      // Headroom at the 4% stress case — the figure the Reads inverted.
      expect(row.fcf - verdict.stressMonthly!).toBe(row.surplusAt4);
      // Plan is the 7% case, which is cheaper still, so the surplus is larger.
      expect(verdict.planRatePct).toBe(7);
      expect(verdict.surplusAtPlan).toBe(row.fcf - verdict.planMonthly!);
      expect(verdict.surplusAtPlan!).toBeGreaterThan(row.surplusAt4);
    });
  }
});

describe('computeGoalVerdict — the invariant', () => {
  it('emits exactly one of surplusAtPlan / shortfallAtPlan when funded', () => {
    const v = computeGoalVerdict({
      goal: investmentGoal(1249),
      freeCashFlow: 1470,
      asOf: AS_OF,
    });
    expect(v.surplusAtPlan).not.toBeNull();
    expect(v.shortfallAtPlan).toBeNull();
  });

  it('emits exactly one of surplusAtPlan / shortfallAtPlan when not funded', () => {
    const v = computeGoalVerdict({
      goal: investmentGoal(1249),
      freeCashFlow: 100,
      asOf: AS_OF,
    });
    expect(v.fundedAtPlan).toBe(false);
    expect(v.shortfallAtPlan).toBe(v.planMonthly! - 100);
    expect(v.surplusAtPlan).toBeNull();
  });

  it('treats free cash exactly equal to the plan figure as funded, with zero surplus', () => {
    const band = computeGoalVerdict({
      goal: investmentGoal(1249),
      freeCashFlow: 999_999,
      asOf: AS_OF,
    });
    const v = computeGoalVerdict({
      goal: investmentGoal(1249),
      freeCashFlow: band.planMonthly!,
      asOf: AS_OF,
    });
    expect(v.fundedAtPlan).toBe(true);
    expect(v.surplusAtPlan).toBe(0);
    expect(v.shortfallAtPlan).toBeNull();
  });
});

describe('computeGoalVerdict — the stress case', () => {
  it('flags the conservative case as uncovered and sizes the gap', () => {
    // Free cash sits between the 7% plan figure and the 4% stress figure.
    const probe = computeGoalVerdict({
      goal: investmentGoal(1000),
      freeCashFlow: 999_999,
      asOf: AS_OF,
    });
    const between = Math.round((probe.planMonthly! + probe.stressMonthly!) / 2);

    const v = computeGoalVerdict({
      goal: investmentGoal(1000),
      freeCashFlow: between,
      asOf: AS_OF,
    });
    expect(v.fundedAtPlan).toBe(true);
    expect(v.surplusAtPlan).toBe(between - v.planMonthly!);
    expect(v.stressCovered).toBe(false);
    expect(v.stressShortfall).toBe(v.stressMonthly! - between);
  });

  it('picks the LOWEST rate as the stress case (the dearest monthly)', () => {
    const v = computeGoalVerdict({
      goal: investmentGoal(1000),
      freeCashFlow: 2000,
      asOf: AS_OF,
    });
    expect(v.requirements.map((r) => r.ratePct)).toEqual([4, 7, 10]);
    expect(v.stressRatePct).toBe(4);
    expect(v.stressMonthly).toBeGreaterThan(v.planMonthly!);
  });

  it('reports £0/mo funded at plan when the existing pot compounds past the target', () => {
    const v = computeGoalVerdict({
      goal: {
        type: 'investment',
        target_amount: 50_000,
        current_amount: 45_000, // grows past 50k at 7% over 5 years on its own
        target_date: IN_60_MONTHS,
        monthly_required_saving: null,
      },
      freeCashFlow: 300,
      asOf: AS_OF,
    });
    expect(v.planMonthly).toBe(0);
    expect(v.fundedAtPlan).toBe(true);
    expect(v.surplusAtPlan).toBe(300);
    expect(v.shortfallAtPlan).toBeNull();
  });
});

describe('computeGoalVerdict — non-investment goals', () => {
  it('uses the stored straight-line requirement, with no stress case', () => {
    const v = computeGoalVerdict({
      goal: {
        type: 'savings',
        target_amount: 10_000,
        current_amount: 0,
        target_date: IN_60_MONTHS,
        monthly_required_saving: 400,
      },
      freeCashFlow: 550,
      asOf: AS_OF,
    });
    expect(v.computable).toBe(true);
    expect(v.requirements).toEqual([{ ratePct: null, monthly: 400 }]);
    expect(v.planMonthly).toBe(400);
    expect(v.planRatePct).toBeNull();
    expect(v.stressMonthly).toBeNull();
    expect(v.stressRatePct).toBeNull();
    expect(v.stressCovered).toBeNull();
    expect(v.stressShortfall).toBeNull();
    expect(v.fundedAtPlan).toBe(true);
    expect(v.surplusAtPlan).toBe(150);
  });

  it('reports the straight-line shortfall when free cash falls short', () => {
    const v = computeGoalVerdict({
      goal: {
        type: 'savings',
        target_amount: 10_000,
        current_amount: 0,
        target_date: IN_60_MONTHS,
        monthly_required_saving: 400,
      },
      freeCashFlow: 250,
      asOf: AS_OF,
    });
    expect(v.fundedAtPlan).toBe(false);
    expect(v.shortfallAtPlan).toBe(150);
    expect(v.surplusAtPlan).toBeNull();
  });
});

describe('computeGoalVerdict — pace computable, verdict not', () => {
  // Free cash flow gates the VERDICT only. The pace figures still render the
  // rate band in the prompt, so they must survive — otherwise buildGoalSummary
  // would have to compute the band a second time and the two could disagree.
  it('keeps the pace figures but states no verdict when free cash flow is unknown', () => {
    const v = computeGoalVerdict({
      goal: investmentGoal(1249),
      freeCashFlow: null,
      asOf: AS_OF,
    });
    expect(v.computable).toBe(true);
    expect(v.requirements).toHaveLength(3);
    expect(v.planMonthly).toBeGreaterThan(0);
    expect(v.stressMonthly).toBe(1249);
    // …and nothing that would let a caller read "unknown" as "not funded".
    expect(v.freeCashFlow).toBeNull();
    expect(v.fundedAtPlan).toBeNull();
    expect(v.surplusAtPlan).toBeNull();
    expect(v.shortfallAtPlan).toBeNull();
    expect(v.stressCovered).toBeNull();
    expect(v.stressShortfall).toBeNull();
  });
});

describe('computeGoalVerdict — not computable', () => {
  const expectSilent = (v: ReturnType<typeof computeGoalVerdict>) => {
    expect(v.computable).toBe(false);
    expect(v.requirements).toEqual([]);
    expect(v.planMonthly).toBeNull();
    expect(v.surplusAtPlan).toBeNull();
    expect(v.shortfallAtPlan).toBeNull();
    expect(v.stressCovered).toBeNull();
    expect(v.stressShortfall).toBeNull();
    expect(v.fundedAtPlan).toBeNull();
  };

  it('no goal', () => {
    expectSilent(computeGoalVerdict({ goal: null, freeCashFlow: 1470, asOf: AS_OF }));
  });

  it('no target date', () => {
    expectSilent(
      computeGoalVerdict({
        goal: { ...investmentGoal(1249)!, target_date: null },
        freeCashFlow: 1470,
        asOf: AS_OF,
      }),
    );
  });

  it('target date in the past (monthsLeft <= 0)', () => {
    expectSilent(
      computeGoalVerdict({
        goal: { ...investmentGoal(1249)!, target_date: '2025-06-01' },
        freeCashFlow: 1470,
        asOf: AS_OF,
      }),
    );
  });

  it('target date today (monthsLeft === 0)', () => {
    expectSilent(
      computeGoalVerdict({
        goal: { ...investmentGoal(1249)!, target_date: '2026-01-15' },
        freeCashFlow: 1470,
        asOf: AS_OF,
      }),
    );
  });

  it('investment goal with no target amount', () => {
    expectSilent(
      computeGoalVerdict({
        goal: { ...investmentGoal(1249)!, target_amount: null },
        freeCashFlow: 1470,
        asOf: AS_OF,
      }),
    );
  });

  it('non-investment goal with no stored monthly requirement', () => {
    expectSilent(
      computeGoalVerdict({
        goal: {
          type: 'savings',
          target_amount: 10_000,
          current_amount: 0,
          target_date: IN_60_MONTHS,
          monthly_required_saving: null,
        },
        freeCashFlow: 1470,
        asOf: AS_OF,
      }),
    );
  });
});
