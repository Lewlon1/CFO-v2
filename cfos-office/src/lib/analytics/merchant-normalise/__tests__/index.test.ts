import { describe, it, expect } from 'vitest';
import { normaliseMerchantDescription } from '../index';

describe('normaliseMerchantDescription', () => {
  it('strips POS PURCHASE prefix', () => {
    expect(normaliseMerchantDescription('POS PURCHASE POLLO TROPICAL #142'))
      .toBe('POLLO TROPICAL #142');
  });

  it('strips ATM WITHDRAWAL prefix', () => {
    expect(normaliseMerchantDescription('ATM WITHDRAWAL FIRSTBANK CAROLINA 003'))
      .toBe('FIRSTBANK CAROLINA 003');
  });

  it('strips DIRECT DEP prefix', () => {
    expect(normaliseMerchantDescription('DIRECT DEP COMPANY NAME')).toBe('COMPANY NAME');
  });

  it('strips DIRECT DEPOSIT prefix', () => {
    expect(normaliseMerchantDescription('DIRECT DEPOSIT EMPLOYER ABC')).toBe('EMPLOYER ABC');
  });

  it('handles mixed case prefix', () => {
    expect(normaliseMerchantDescription('Pos Purchase Pret a Manger LDN'))
      .toBe('Pret a Manger LDN');
  });

  it('strips trailing reference numbers', () => {
    expect(normaliseMerchantDescription('POS PURCHASE Starbucks REF 12345-678'))
      .toBe('Starbucks');
  });

  it('strips trailing long digit sequences', () => {
    expect(normaliseMerchantDescription('POS PURCHASE Amazon 123456789'))
      .toBe('Amazon');
  });

  it('collapses internal whitespace', () => {
    expect(normaliseMerchantDescription('POS    PURCHASE   Sainsburys'))
      .toBe('Sainsburys');
  });

  it('handles unprefixed strings unchanged', () => {
    expect(normaliseMerchantDescription('PRET A MANGER LDN')).toBe('PRET A MANGER LDN');
  });

  it('handles empty input', () => {
    expect(normaliseMerchantDescription('')).toBe('');
  });

  it('does not lowercase brand names', () => {
    expect(normaliseMerchantDescription('POS PURCHASE iCloud Subscription'))
      .toBe('iCloud Subscription');
  });

  it('strips multiple stacked prefixes', () => {
    expect(normaliseMerchantDescription('CARD PURCHASE POS Purchase Starbucks'))
      .toBe('Starbucks');
  });

  it('preserves branch and location markers', () => {
    // The normaliser intentionally does NOT collapse branch suffixes/locations —
    // that's brand rollup territory, handled at the query layer.
    expect(normaliseMerchantDescription('POS PURCHASE POLLO TROPICAL DRIVE THRU'))
      .toBe('POLLO TROPICAL DRIVE THRU');
  });

  it('handles CONTACTLESS prefix', () => {
    expect(normaliseMerchantDescription('CONTACTLESS Pret a Manger'))
      .toBe('Pret a Manger');
  });

  it('handles ONLINE prefix', () => {
    expect(normaliseMerchantDescription('ONLINE Amazon UK'))
      .toBe('Amazon UK');
  });
});
