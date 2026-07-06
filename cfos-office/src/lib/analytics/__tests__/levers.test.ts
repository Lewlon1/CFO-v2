import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectBlocker, deriveLevers } from '../levers';
import { categoryLabel, DISCRETIONARY_CATEGORY_IDS } from '../categories';
import type { SpendingBreakdown } from '../spending-breakdown';

type Budget = {
  netIncome: number | null;
  partnerContribution: number;
  fixedCosts: number;
  monthlyRent: number | null;
  grossSalary: number | null;
};

const goalWithEverything = {
  id: 'goal-1',
  name: 'House deposit',
  target_amount: 50000,
  current_amount: 2000,
  target_date: '2031-05-28',
};

const fullBudget: Budget = {
  netIncome: 2700,
  partnerContribution: 0,
  fixedCosts: 1366.5,
  monthlyRent: 1200,
  grossSalary: 36000,
};

describe('detectBlocker — math-blocking detector', () => {
  it('returns null when every required pace input is populated', () => {
    expect(detectBlocker(goalWithEverything, fullBudget)).toBeNull();
  });

  it('flags net_monthly_income as the highest-priority blocker (the Spain case)', () => {
    const budget: Budget = { ...fullBudget, netIncome: null };
    const blocker = detectBlocker(goalWithEverything, budget);
    expect(blocker).not.toBeNull();
    expect(blocker?.type).toBe('supply_input');
    if (blocker?.type === 'supply_input') {
      expect(blocker.field).toBe('net_monthly_income');
      expect(blocker.goalName).toBe('House deposit');
      expect(blocker.unlocks).toContain('House deposit');
    }
  });

  it('income blocker beats target_date blocker when both are missing', () => {
    const budget: Budget = { ...fullBudget, netIncome: null };
    const goal = { ...goalWithEverything, target_date: null };
    const blocker = detectBlocker(goal, budget);
    if (blocker?.type === 'supply_input') {
      expect(blocker.field).toBe('net_monthly_income');
    } else {
      throw new Error('Expected a supply_input blocker');
    }
  });

  it('flags target_date when income is set but date is null', () => {
    const goal = { ...goalWithEverything, target_date: null };
    const blocker = detectBlocker(goal, fullBudget);
    if (blocker?.type === 'supply_input') {
      expect(blocker.field).toBe('target_date');
      expect(blocker.unlocks).toContain('House deposit');
    } else {
      throw new Error('Expected a supply_input blocker');
    }
  });

  it('flags target_amount when income + date set but amount is null', () => {
    const goal = { ...goalWithEverything, target_amount: null };
    const blocker = detectBlocker(goal, fullBudget);
    if (blocker?.type === 'supply_input') {
      expect(blocker.field).toBe('target_amount');
    } else {
      throw new Error('Expected a supply_input blocker');
    }
  });

  it('control: Dorcas-style user (income populated, goal date set) → no blocker, no income-request CTA', () => {
    // Dorcas has goal "Pay off debt", target_amount 18000, target_date set, and
    // recurring expenses exist. If we ever wired her up with net_monthly_income,
    // the detector must yield null — i.e. the Read should NOT request income.
    const goal = {
      id: 'dorcas-goal',
      name: 'Pay off debt',
      target_amount: 18000,
      current_amount: 0,
      target_date: '2028-05-27',
    };
    const budget: Budget = {
      netIncome: 3500,
      partnerContribution: 0,
      fixedCosts: 600,
      monthlyRent: 800,
      grossSalary: 45000,
    };
    expect(detectBlocker(goal, budget)).toBeNull();
  });
});

// ── Supabase mock — table → rows, with the terminal shapes the lever helpers use
// (.single() for user_profiles, .limit() for snapshots, awaited builder otherwise).
function makeSupabase(data: Record<string, unknown>): SupabaseClient {
  return {
    from: (table: string) => {
      const result = { data: data[table] ?? null, error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        in: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(result),
        single: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (v: typeof result) => unknown) => resolve(result),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

// netIncome + target + date all set → no supply_input blocker; goal impact computable.
const baseData = {
  goals: [
    { id: 'g1', name: 'House deposit', target_amount: 20000, current_amount: 0, target_date: '2028-01-01', status: 'active' },
  ],
  user_profiles: { net_monthly_income: 3000, partner_monthly_contribution: 0, monthly_rent: 1200, gross_salary: null },
  recurring_expenses: [],
  monthly_snapshots: [{ total_discretionary: 1500 }],
};

function breakdown(top: Array<{ category: string; total: number; pct: number }>): SpendingBreakdown {
  return {
    total_spend: top.reduce((s, t) => s + t.total, 0),
    window_days: 90,
    top_categories: top,
    biggest_merchant: null,
    largest_transaction: null,
    uncategorised_pct: 0,
  };
}

describe('categoryLabel', () => {
  it('humanises slugs and never leaks raw underscores to prose', () => {
    expect(categoryLabel('eat_drinking_out')).toBe('eating & drinking out');
    expect(categoryLabel('utilities_bills')).toBe('utilities & bills');
    expect(categoryLabel('personal_care')).toBe('personal care');
    expect(categoryLabel('groceries')).toBe('groceries');
    expect(categoryLabel('transport')).toBe('transport');
    expect(categoryLabel('Uncategorised')).toBe('uncategorised');
    expect(categoryLabel('')).toBe('uncategorised');
    expect(categoryLabel('eat_drinking_out')).not.toContain('_');
  });
});

describe('DISCRETIONARY_CATEGORY_IDS', () => {
  it('excludes essentials/fixed (the renfe / council-tax failure mode), includes discretionary', () => {
    for (const essential of ['transport', 'utilities_bills', 'groceries', 'housing', 'health']) {
      expect(DISCRETIONARY_CATEGORY_IDS.has(essential)).toBe(false);
    }
    for (const disc of ['eat_drinking_out', 'subscriptions', 'shopping', 'entertainment']) {
      expect(DISCRETIONARY_CATEGORY_IDS.has(disc)).toBe(true);
    }
  });
});

describe('deriveLevers — cut lever targets the biggest discretionary category', () => {
  it('picks eating-out over a bigger transport line, labelled humanly (not "transport", not a slug)', async () => {
    const { levers, blocker } = await deriveLevers({
      supabase: makeSupabase(baseData),
      userId: 'u1',
      currency: 'EUR',
      windowDays: 90,
      spendingBreakdown: breakdown([
        { category: 'transport', total: 900, pct: 30 }, // biggest overall, but ESSENTIAL
        { category: 'eat_drinking_out', total: 600, pct: 20 }, // biggest DISCRETIONARY → the cut
        { category: 'groceries', total: 500, pct: 17 },
        { category: 'shopping', total: 300, pct: 10 },
      ]),
    });
    expect(blocker).toBeNull();
    const cut = levers.find((l) => l.type === 'cut');
    expect(cut).toBeDefined();
    if (cut && cut.type === 'cut') {
      expect(cut.category).toBe('eating & drinking out');
      expect(cut.currentMonthly).toBe(Math.round(600 / (90 / 30.44)));
      expect(cut.suggestedCut).toBe(Math.round((600 / (90 / 30.44)) * 0.25));
    }
  });

  it('normalises by ACTUAL data coverage, not the fixed 90d window — a 1-month upload is not understated ~3x', async () => {
    // Regression: with one calendar month of data, dividing the window total by
    // a fixed 90d window (≈2.96 months) understated every "/mo" figure ~3x — a
    // real $362 shopping month surfaced as "$122 a month". effectiveMonths is the
    // actual coverage; the lever must divide by THAT, floored at 1 month.
    const { levers } = await deriveLevers({
      supabase: makeSupabase(baseData),
      userId: 'u1',
      currency: 'EUR',
      windowDays: 90,
      effectiveMonths: 1, // one month of real data, not a full 90d window
      spendingBreakdown: breakdown([{ category: 'shopping', total: 362, pct: 13 }]),
    });
    const cut = levers.find((l) => l.type === 'cut');
    expect(cut).toBeDefined();
    if (cut && cut.type === 'cut') {
      expect(cut.currentMonthly).toBe(362); // the month's real spend, not 362/2.957
      expect(cut.currentMonthly).not.toBe(Math.round(362 / (90 / 30.44))); // not the ~$122 bug
      expect(cut.suggestedCut).toBe(Math.round(362 * 0.25)); // ~$91, sized to reality
    }
  });

  it('emits NO cut lever when every sizeable category is an essential (no renfe-style staple)', async () => {
    const { levers } = await deriveLevers({
      supabase: makeSupabase(baseData),
      userId: 'u1',
      currency: 'EUR',
      windowDays: 90,
      spendingBreakdown: breakdown([
        { category: 'housing', total: 3000, pct: 50 },
        { category: 'utilities_bills', total: 1200, pct: 20 },
        { category: 'groceries', total: 1000, pct: 17 },
        { category: 'transport', total: 800, pct: 13 },
      ]),
    });
    expect(levers.find((l) => l.type === 'cut')).toBeUndefined();
  });

  it('emits NO cut lever when there is no breakdown', async () => {
    const { levers } = await deriveLevers({
      supabase: makeSupabase(baseData),
      userId: 'u1',
      currency: 'EUR',
      spendingBreakdown: null,
    });
    expect(levers.find((l) => l.type === 'cut')).toBeUndefined();
  });
});

describe('deriveLevers — accelerate lever when the goal is funded at plan', () => {
  // Retirement pot funded by growth: pace.ts persists on_track=true and
  // monthly_required_saving=0. The lever engine must NOT manufacture a cut.
  const onTrackData = {
    goals: [
      {
        id: 'g1',
        name: 'Retirement pot',
        type: 'investment',
        target_amount: 600000,
        current_amount: 400000,
        target_date: '2034-06-18',
        monthly_required_saving: 0,
        on_track: true,
        status: 'active',
      },
    ],
    user_profiles: { net_monthly_income: 3500, partner_monthly_contribution: 0, monthly_rent: 400, gross_salary: null },
    recurring_expenses: [],
    monthly_snapshots: [{ total_discretionary: 500 }],
  };

  it('emits an accelerate lever (not a cut) when on_track is true, sized to the spare cash', async () => {
    const { levers, blocker } = await deriveLevers({
      supabase: makeSupabase(onTrackData),
      userId: 'u1',
      currency: 'GBP',
      windowDays: 90,
      spendingBreakdown: breakdown([{ category: 'eat_drinking_out', total: 600, pct: 20 }]),
    });
    expect(blocker).toBeNull();
    expect(levers.find((l) => l.type === 'cut')).toBeUndefined();
    const acc = levers.find((l) => l.type === 'accelerate');
    expect(acc).toBeDefined();
    if (acc && acc.type === 'accelerate') {
      // surplus = 3500 income − 400 rent (the reconciled fixed-cost total —
      // there are no recurring_expenses rows in this fixture, only the
      // profile's monthly_rent) − 500 discretionary = 2600; required 0 → 2600 spare
      expect(acc.surplusOverRequired).toBe(2600);
      expect(acc.goalName).toBe('Retirement pot');
      // real snapshot history (total_discretionary) is on hand → observed, not modelled
      expect(acc.basis).toBe('observed');
      // investment goal → conservative stress gap is computed (a number, not null)
      expect(acc.stressTestGap).not.toBeNull();
    }
  });

  it('still derives a cut when surplus does NOT cover the requirement (on_track null fallback)', async () => {
    const data = {
      ...onTrackData,
      goals: [
        {
          id: 'g1',
          name: 'House deposit',
          type: 'savings',
          target_amount: 20000,
          current_amount: 0,
          target_date: '2028-01-01',
          monthly_required_saving: 5000,
          on_track: null,
          status: 'active',
        },
      ],
      monthly_snapshots: [{ total_discretionary: 1500 }],
    };
    const { levers } = await deriveLevers({
      supabase: makeSupabase(data),
      userId: 'u1',
      currency: 'GBP',
      windowDays: 90,
      spendingBreakdown: breakdown([{ category: 'eat_drinking_out', total: 600, pct: 20 }]),
    });
    // surplus = 3500 income − 400 rent − 1500 discretionary = 1600 < 5000 required → not funded at plan
    expect(levers.find((l) => l.type === 'accelerate')).toBeUndefined();
    expect(levers.find((l) => l.type === 'cut')).toBeDefined();
  });
});

// Regression fixtures for the dorcas/lewis staging review (remediation plan,
// Issue 1). Both users were told a false "funded at plan / spare cash"
// figure. Both fixtures set `on_track: true` on the goal deliberately — a
// STALE persisted verdict that the pre-fix accelerate gate trusted outright
// (`goal.on_track === true` short-circuited the check). The fix requires a
// live surplus-vs-required comparison from the unified module regardless of
// what on_track says, so these assert the lever does NOT fire even with a
// (wrong) on_track: true sitting in the goal row.
describe('deriveLevers — dorcas/lewis regression (Issue 1): no false "funded" verdict', () => {
  it('dorcas-style: rent + no recurring rows, real discretionary spend pushes the user over budget', async () => {
    const dorcasData = {
      goals: [
        {
          id: 'g-dorcas',
          name: 'Pay off debt',
          type: 'savings',
          target_amount: 18000,
          current_amount: 0,
          target_date: '2028-05-27',
          monthly_required_saving: 200,
          on_track: true, // stale — the live check must still refuse
          status: 'active',
        },
      ],
      // No rent field is dropped and no declared bills exist in this table
      // shape, but the point of the regression is: fixed costs must be
      // sourced from the reconciled total (rent included), NOT a naive
      // recurring_expenses sum that reads $0 when this table is empty.
      user_profiles: { net_monthly_income: 4500, partner_monthly_contribution: 0, monthly_rent: 2200, gross_salary: null },
      recurring_expenses: [],
      monthly_snapshots: [{ total_discretionary: 2500 }],
    };
    const { levers, blocker } = await deriveLevers({
      supabase: makeSupabase(dorcasData),
      userId: 'dorcas',
      currency: 'USD',
      windowDays: 90,
      spendingBreakdown: null,
    });
    expect(blocker).toBeNull();
    // surplus = 4500 income − 2200 rent − 2500 observed discretionary = −200 < 200 required.
    expect(levers.find((l) => l.type === 'accelerate')).toBeUndefined();
  });

  it('lewis-style: reconciled recurring bills + observed discretionary spend, surplus falls short of the goal requirement', async () => {
    const lewisData = {
      goals: [
        {
          id: 'g-lewis',
          name: 'Investment pot',
          type: 'savings',
          target_amount: 50000,
          current_amount: 10000,
          target_date: '2032-01-01',
          monthly_required_saving: 1800,
          on_track: true, // stale — the live check must still refuse
          status: 'active',
        },
      ],
      user_profiles: { net_monthly_income: 3200, partner_monthly_contribution: 0, monthly_rent: 1200, gross_salary: null },
      recurring_expenses: [{ name: 'internet', amount: 292, frequency: 'monthly', status: 'tracked' }],
      monthly_snapshots: [{ total_discretionary: 225 }],
    };
    const { levers, blocker } = await deriveLevers({
      supabase: makeSupabase(lewisData),
      userId: 'lewis',
      currency: 'EUR',
      windowDays: 90,
      spendingBreakdown: null,
    });
    expect(blocker).toBeNull();
    // surplus = 3200 income − 1492 reconciled fixed (1200 rent + 292 recurring) − 225 discretionary
    //         = 1483, short of the 1800 requirement by 317 — matches the ~€317/mo shortfall.
    expect(levers.find((l) => l.type === 'accelerate')).toBeUndefined();
  });
});
