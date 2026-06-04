import { describe, it, expect } from 'vitest';
import {
  futureValueSeries,
  requiredMonthlyForTarget,
  requiredMonthlyBand,
  INVESTMENT_RATES_PCT,
} from './compound-growth';

describe('futureValueSeries', () => {
  it('r=0 degrades to linear: initial + monthly*months', () => {
    expect(
      futureValueSeries({ initialAmount: 1000, monthlyContribution: 100, annualRatePct: 0, months: 12 }),
    ).toBe(1000 + 100 * 12);
  });

  it('grows a lump sum by compound interest', () => {
    // 1000 at 12%/yr (1%/mo) for 12 months ≈ 1000 * 1.01^12 ≈ 1126.83
    const fv = futureValueSeries({ initialAmount: 1000, monthlyContribution: 0, annualRatePct: 12, months: 12 });
    expect(fv).toBeCloseTo(1000 * Math.pow(1.01, 12), 2);
  });

  it('returns the initial amount when months <= 0', () => {
    expect(
      futureValueSeries({ initialAmount: 500, monthlyContribution: 100, annualRatePct: 7, months: 0 }),
    ).toBe(500);
  });

  it('contributions earn growth (more than their face sum)', () => {
    const fv = futureValueSeries({ initialAmount: 0, monthlyContribution: 100, annualRatePct: 7, months: 120 });
    expect(fv).toBeGreaterThan(100 * 120);
  });
});

describe('requiredMonthlyForTarget', () => {
  it('r=0 is the linear gap divided by months', () => {
    const m = requiredMonthlyForTarget({ targetAmount: 12000, currentAmount: 0, annualRatePct: 0, months: 12 });
    expect(m).toBe(1000);
  });

  it('nets off the current amount (linear)', () => {
    const m = requiredMonthlyForTarget({ targetAmount: 12000, currentAmount: 6000, annualRatePct: 0, months: 12 });
    expect(m).toBe(500);
  });

  it('round-trips: contributing the required monthly reaches the target', () => {
    const months = 120;
    const target = 200000;
    const current = 50000;
    const monthly = requiredMonthlyForTarget({ targetAmount: target, currentAmount: current, annualRatePct: 7, months })!;
    const fv = futureValueSeries({ initialAmount: current, monthlyContribution: monthly, annualRatePct: 7, months });
    expect(fv).toBeCloseTo(target, 0);
  });

  it('returns 0 when the seed alone compounds past the target', () => {
    // 100k at 7% over 30 years dwarfs a 120k target.
    const m = requiredMonthlyForTarget({ targetAmount: 120000, currentAmount: 100000, annualRatePct: 7, months: 360 });
    expect(m).toBe(0);
  });

  it('returns null with no horizon', () => {
    expect(requiredMonthlyForTarget({ targetAmount: 1000, currentAmount: 0, annualRatePct: 7, months: 0 })).toBeNull();
  });

  // The headline bug: test12's €500k/15yr index-fund goal read as needing
  // €2,389/mo (linear) and looked impossible. With compounding it's a few
  // hundred a month — well within reach.
  it('test12 sanity: 500k from 70k over 180mo at 7% is far below the linear 2389', () => {
    const linear = (500000 - 70000) / 180; // ≈ 2389
    const grown = requiredMonthlyForTarget({ targetAmount: 500000, currentAmount: 70000, annualRatePct: 7, months: 180 })!;
    expect(linear).toBeCloseTo(2389, 0);
    expect(grown).toBeLessThan(1000);
    expect(grown).toBeGreaterThan(0);
  });
});

describe('requiredMonthlyBand', () => {
  it('returns one entry per default rate, monotonically decreasing with rate', () => {
    const band = requiredMonthlyBand({ targetAmount: 500000, currentAmount: 70000, months: 180 });
    expect(band.map((b) => b.ratePct)).toEqual([...INVESTMENT_RATES_PCT]);
    // Higher assumed return ⇒ lower required monthly.
    expect(band[0].monthly!).toBeGreaterThan(band[1].monthly!);
    expect(band[1].monthly!).toBeGreaterThan(band[2].monthly!);
  });
});
