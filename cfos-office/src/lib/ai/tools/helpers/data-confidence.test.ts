import { describe, expect, it } from 'vitest';
import { assessDataConfidence } from './data-confidence';

describe('assessDataConfidence', () => {
  it('returns low for <14 days', () => {
    const result = assessDataConfidence({ n_transactions: 50, n_days: 10 });
    expect(result.level).toBe('low');
    expect(result.reason).toBe(
      'Less than 2 weeks of data — patterns may not be representative.',
    );
  });

  it('returns low at the boundary of 13 days', () => {
    const result = assessDataConfidence({ n_transactions: 100, n_days: 13 });
    expect(result.level).toBe('low');
  });

  it('returns medium for 14–29 days regardless of transaction count', () => {
    const result = assessDataConfidence({ n_transactions: 5, n_days: 14 });
    expect(result.level).toBe('medium');
    expect(result.reason).toBe('2–4 weeks of data — directional but not confirmed.');
  });

  it('returns medium at the boundary of 29 days', () => {
    const result = assessDataConfidence({ n_transactions: 200, n_days: 29 });
    expect(result.level).toBe('medium');
  });

  it('returns medium with low-sample reason for >=30 days but <20 transactions', () => {
    const result = assessDataConfidence({ n_transactions: 15, n_days: 30 });
    expect(result.level).toBe('medium');
    expect(result.reason).toBe(
      'Sample size of 15 transactions is small for a 30-day window.',
    );
  });

  it('returns high for >=30 days and >=20 transactions', () => {
    const result = assessDataConfidence({ n_transactions: 20, n_days: 30 });
    expect(result.level).toBe('high');
    expect(result.reason).toBe(
      '20 transactions across 30 days is a solid baseline.',
    );
  });

  it('returns high with the actual numbers in the reason', () => {
    const result = assessDataConfidence({ n_transactions: 240, n_days: 90 });
    expect(result.level).toBe('high');
    expect(result.reason).toBe(
      '240 transactions across 90 days is a solid baseline.',
    );
  });

  it('downgrades to low when expected_recurrence_count is <3, even with otherwise-high inputs', () => {
    const result = assessDataConfidence({
      n_transactions: 240,
      n_days: 90,
      expected_recurrence_count: 2,
    });
    expect(result.level).toBe('low');
    expect(result.reason).toBe(
      'Only 2 occurrences — not enough to call a pattern.',
    );
  });

  it('does not downgrade when expected_recurrence_count is >=3', () => {
    const result = assessDataConfidence({
      n_transactions: 20,
      n_days: 30,
      expected_recurrence_count: 3,
    });
    expect(result.level).toBe('high');
  });

  it('downgrades to low for zero occurrences', () => {
    const result = assessDataConfidence({
      n_transactions: 20,
      n_days: 30,
      expected_recurrence_count: 0,
    });
    expect(result.level).toBe('low');
    expect(result.reason).toBe(
      'Only 0 occurrences — not enough to call a pattern.',
    );
  });
});
