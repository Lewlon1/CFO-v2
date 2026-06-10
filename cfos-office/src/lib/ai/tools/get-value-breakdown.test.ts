import { describe, it, expect } from 'vitest';
import { summariseValueBreakdown } from './get-value-breakdown';

// A transaction's value_category is only ASSERTED into Foundation/Burden/
// Investment/Leak when the user confirmed it OR the system is confident
// (>= 0.7, matching retake-trigger.ts / context-builder.ts). Otherwise it is
// "uncategorised" — the system's low-confidence guess (e.g. the 0.15
// category_default that tagged all unsorted dining as 'leak') must not be
// reported as a value verdict the user never made.
describe('summariseValueBreakdown', () => {
  it('does NOT report low-confidence unconfirmed category defaults as Leak', () => {
    // The exact May-dining shape: 24 dining txns, all leak @ 0.15, unconfirmed.
    const rows = Array.from({ length: 3 }, (_, i) => ({
      amount: -20 - i,
      value_category: 'leak',
      value_confidence: 0.15,
      value_confirmed_by_user: false,
      description: `Restaurant ${i}`,
    }));
    const { breakdown, uncategorised, total } = summariseValueBreakdown(rows);
    expect(breakdown.leak.total).toBe(0);
    expect(breakdown.leak.count).toBe(0);
    expect(uncategorised.total).toBeCloseTo(63, 2); // 20+21+22
    expect(uncategorised.count).toBe(3);
    expect(total).toBeCloseTo(63, 2);
  });

  it('counts a user-confirmed leak as Leak even at low stored confidence', () => {
    const rows = [
      { amount: -50, value_category: 'leak', value_confidence: 0.15, value_confirmed_by_user: true, description: 'Bar' },
    ];
    const { breakdown } = summariseValueBreakdown(rows);
    expect(breakdown.leak.total).toBe(50);
    expect(breakdown.leak.count).toBe(1);
  });

  it('counts a high-confidence (>= 0.7) prediction toward its bucket', () => {
    const rows = [
      { amount: -30, value_category: 'foundation', value_confidence: 0.85, value_confirmed_by_user: false, description: 'Aldi' },
    ];
    const { breakdown } = summariseValueBreakdown(rows);
    expect(breakdown.foundation.total).toBe(30);
  });

  it('treats null confidence (unconfirmed) as uncategorised', () => {
    const rows = [
      { amount: -40, value_category: 'leak', value_confidence: null, value_confirmed_by_user: false, description: 'Mystery' },
    ];
    const { breakdown, uncategorised } = summariseValueBreakdown(rows);
    expect(breakdown.leak.total).toBe(0);
    expect(uncategorised.total).toBe(40);
  });

  it('computes percentages against total spend and keeps explicit unsure separate', () => {
    const rows = [
      { amount: -75, value_category: 'foundation', value_confidence: 0.9, value_confirmed_by_user: true, description: 'Rent share' },
      { amount: -25, value_category: 'unsure', value_confidence: null, value_confirmed_by_user: false, description: 'Unknown' },
    ];
    const { breakdown, uncategorised, total } = summariseValueBreakdown(rows);
    expect(total).toBe(100);
    expect(breakdown.foundation.total).toBe(75);
    expect(breakdown.foundation.percentage).toBe(75);
    expect(uncategorised.total).toBe(25);
  });
});
