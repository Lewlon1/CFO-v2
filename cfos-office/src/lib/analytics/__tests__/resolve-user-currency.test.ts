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
});
