import { describe, it, expect } from 'vitest';
import { resolveUserCurrency } from '../insight-engine';

describe('resolveUserCurrency', () => {
  it('GB country with EUR profile (schema default) -> GBP (override)', () => {
    expect(resolveUserCurrency('GB', 'EUR')).toBe('GBP');
  });

  it('GB country with null profile -> GBP (inferred)', () => {
    expect(resolveUserCurrency('GB', null)).toBe('GBP');
  });

  it('US country with EUR profile -> USD (override)', () => {
    expect(resolveUserCurrency('US', 'EUR')).toBe('USD');
  });

  it('ES country with EUR profile -> EUR (no override needed)', () => {
    expect(resolveUserCurrency('ES', 'EUR')).toBe('EUR');
  });

  it('GB country with explicit non-EUR profile (GBP) -> GBP (kept)', () => {
    expect(resolveUserCurrency('GB', 'GBP')).toBe('GBP');
  });

  it('GB country with deliberate user choice of USD -> USD (kept, user override)', () => {
    expect(resolveUserCurrency('GB', 'USD')).toBe('USD');
  });

  it('null country with USD profile -> USD (kept)', () => {
    expect(resolveUserCurrency(null, 'USD')).toBe('USD');
  });

  it('null country with null profile -> EUR (final fallback)', () => {
    expect(resolveUserCurrency(null, null)).toBe('EUR');
  });

  it('lowercase country code is normalised', () => {
    expect(resolveUserCurrency('gb', 'EUR')).toBe('GBP');
  });

  describe('transaction-derived inference', () => {
    const gbpTxns = Array.from({ length: 10 }, () => ({ currency: 'GBP' }));
    const mixedTxns = [
      ...Array.from({ length: 6 }, () => ({ currency: 'GBP' })),
      ...Array.from({ length: 4 }, () => ({ currency: 'EUR' })),
    ];

    it('null country + null profile + GBP transactions -> GBP (transaction-derived)', () => {
      expect(resolveUserCurrency(null, null, gbpTxns)).toBe('GBP');
    });

    it('null country + EUR profile (default) + GBP transactions -> GBP (transactions win)', () => {
      expect(resolveUserCurrency(null, 'EUR', gbpTxns)).toBe('GBP');
    });

    it('user-set non-default profile currency beats transactions (user choice wins)', () => {
      expect(resolveUserCurrency(null, 'USD', gbpTxns)).toBe('USD');
    });

    it('mixed transactions below 70% dominance -> falls through to country/profile', () => {
      // 60% GBP, 40% EUR -> no dominant currency, fallback applies.
      expect(resolveUserCurrency(null, 'EUR', mixedTxns)).toBe('EUR');
    });

    it('fewer than 5 transactions are ignored (insufficient signal)', () => {
      const fewTxns = Array.from({ length: 3 }, () => ({ currency: 'GBP' }));
      expect(resolveUserCurrency(null, 'EUR', fewTxns)).toBe('EUR');
    });

    it('transactions with null currency are ignored', () => {
      const nullCurrencyTxns = Array.from({ length: 10 }, () => ({ currency: null }));
      expect(resolveUserCurrency(null, 'EUR', nullCurrencyTxns)).toBe('EUR');
    });
  });
});
