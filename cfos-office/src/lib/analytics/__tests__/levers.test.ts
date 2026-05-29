import { describe, it, expect } from 'vitest';
import { detectBlocker } from '../levers';

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
