import { describe, it, expect } from 'vitest';
import { monthsBetween, targetDateFromDuration } from './pace';

describe('monthsBetween', () => {
  it('counts whole years exactly when day-of-month matches', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    const to = new Date('2031-05-28T00:00:00Z');
    expect(monthsBetween(from, to)).toBe(60);
  });

  it('subtracts a month when target day is before from day', () => {
    // 2026-05-28 → 2026-06-27 is 30 days = not quite one full month.
    const from = new Date('2026-05-28T00:00:00Z');
    const to = new Date('2026-06-27T00:00:00Z');
    expect(monthsBetween(from, to)).toBe(0);
  });

  it('counts a full month when target day matches', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    const to = new Date('2026-06-28T00:00:00Z');
    expect(monthsBetween(from, to)).toBe(1);
  });

  it('handles year boundaries', () => {
    const from = new Date('2026-12-15T00:00:00Z');
    const to = new Date('2027-01-14T00:00:00Z');
    expect(monthsBetween(from, to)).toBe(0); // 14 < 15 → not a full month
    const to2 = new Date('2027-01-15T00:00:00Z');
    expect(monthsBetween(from, to2)).toBe(1);
  });

  it('handles Lewis case: 5 years stays 60, 7 years stays 84', () => {
    // The "5 years from May 28" goal should be exactly 60 months.
    const from = new Date('2026-05-28T00:00:00Z');
    expect(monthsBetween(from, new Date('2031-05-28T00:00:00Z'))).toBe(60);
    // Lewis's wrong-date goal (which LLM picked as 7 years) was 84 months.
    expect(monthsBetween(from, new Date('2033-05-28T00:00:00Z'))).toBe(84);
  });
});

describe('targetDateFromDuration', () => {
  it('adds whole years', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    expect(targetDateFromDuration({ durationYears: 5, from })).toBe('2031-05-28');
  });

  it('adds whole months', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    expect(targetDateFromDuration({ durationMonths: 18, from })).toBe('2027-11-28');
  });

  it('combines years and months', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    expect(targetDateFromDuration({ durationYears: 2, durationMonths: 6, from })).toBe('2028-11-28');
  });

  it('repro of Lewis: "over 5 years" from 2026-05-28 yields 2031-05-28, not 2033', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    const result = targetDateFromDuration({ durationYears: 5, from });
    expect(result).toBe('2031-05-28');
    // Sanity: this would round-trip to exactly 60 months.
    expect(monthsBetween(from, new Date(`${result}T00:00:00Z`))).toBe(60);
  });
});
