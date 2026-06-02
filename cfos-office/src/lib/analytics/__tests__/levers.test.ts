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
