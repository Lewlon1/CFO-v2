import { describe, it, expect } from 'vitest';
import { extractNumbers, extractMerchants, validateNarrative } from './insight-validator';
import type { QuotableFact } from '@/lib/analytics/insight-types';

describe('extractNumbers', () => {
  it('extracts integers', () => {
    expect(extractNumbers('You spent 3300 on housing')).toEqual([3300]);
  });

  it('extracts decimals', () => {
    expect(extractNumbers('Gym costs 29.99 a month')).toEqual([29.99]);
  });

  it('ignores commas in thousand separators', () => {
    expect(extractNumbers('£3,300 on housing')).toEqual([3300]);
  });

  it('strips currency symbols', () => {
    expect(extractNumbers('€500 to Vanguard and $20 to coffee')).toEqual([500, 20]);
  });

  it('ignores numbers below 10 (pronouns like "one", "two")', () => {
    expect(extractNumbers('one of five things is that 3300 on rent')).toEqual([3300]);
  });

  it('returns empty for text with no numbers', () => {
    expect(extractNumbers('no numbers here at all')).toEqual([]);
  });

  it('preserves percentage numerators as-is (they are checkable too)', () => {
    expect(extractNumbers('69% of your spend')).toEqual([69]);
  });
});

describe('extractMerchants', () => {
  const knownMerchants = ['glovo', 'deliveroo', 'netflix', 'vanguard', 'puregym'];

  it('matches case-insensitively', () => {
    expect(extractMerchants('You spent £18 on Glovo and £22 on Deliveroo.', knownMerchants))
      .toEqual(['glovo', 'deliveroo']);
  });

  it('matches as whole words only', () => {
    // "vanguardian" should not match "vanguard"
    expect(extractMerchants('vanguardian is not vanguard', knownMerchants))
      .toEqual(['vanguard']);
  });

  it('returns each match once even when mentioned multiple times', () => {
    expect(extractMerchants('Netflix. Netflix. Netflix.', knownMerchants))
      .toEqual(['netflix']);
  });

  it('returns empty for no matches', () => {
    expect(extractMerchants('grocery trips and bus fares', knownMerchants))
      .toEqual([]);
  });

  it('handles empty merchant list', () => {
    expect(extractMerchants('anything', [])).toEqual([]);
  });
});

describe('validateNarrative', () => {
  const facts: QuotableFact[] = [
    { text: '£3,300 on housing', numbers: [3300], merchants: [] },
    { text: '64% of your spend', numbers: [64], merchants: [] },
    { text: '£500 a month to Vanguard', numbers: [500], merchants: ['vanguard'] },
  ];

  it('passes when narrative only cites allowed numbers and merchants', () => {
    const narrative = 'You put £3,300 on housing and £500 a month to Vanguard. Overall, 64% of your spend went to housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });

  it('fails when narrative cites a number not in any fact', () => {
    const narrative = 'You spent 20 a month on coffee and 3300 on housing.';
    const result = validateNarrative(narrative, facts);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('numbers_not_allowed');
      expect(result.offenders).toContain('20');
    }
  });

  it('fails when narrative names a merchant not in any fact', () => {
    const narrative = 'You subscribe to Netflix and put £500 to Vanguard.';
    const result = validateNarrative(narrative, facts, { knownMerchants: ['netflix', 'vanguard'] });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('merchants_not_allowed');
      expect(result.offenders).toContain('netflix');
    }
  });

  it('ignores the transaction-count context fact when not provided', () => {
    // When knownMerchants is not passed, no merchant check runs.
    const narrative = 'A big number here: 3300 on housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });
});

describe('validateNarrative — ±1 tolerance', () => {
  const facts: QuotableFact[] = [
    { text: '30 a month', numbers: [30], merchants: [] },
    { text: '£3,300 on housing', numbers: [3300], merchants: [] },
  ];

  it('accepts a cited number within ±1 of an allowed number (rounding)', () => {
    // Narrative cites £29.99; allowlist has 30. extractNumbers yields 29.99,
    // |29.99 - 30| = 0.01, within tolerance.
    const narrative = 'Gym is £29.99 a month and £3,300 on housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });

  it('accepts a cited number exactly ±1 from an allowed number', () => {
    // Narrative cites 31; allowlist has 30. |31 - 30| = 1, at boundary.
    const narrative = 'Around 31 a month and £3,300 on housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });

  it('rejects a cited number more than 1 away from any allowed number', () => {
    // Narrative cites 35; allowlist has only 30 and 3300. |35-30|=5, |35-3300|=3265.
    const narrative = 'Around 35 a month on something.';
    const result = validateNarrative(narrative, facts);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('numbers_not_allowed');
      expect(result.offenders).toContain('35');
    }
  });
});
