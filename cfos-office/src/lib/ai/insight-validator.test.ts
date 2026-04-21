import { describe, it, expect } from 'vitest';
import { extractNumbers, extractMerchants } from './insight-validator';

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
