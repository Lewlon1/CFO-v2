import { describe, expect, it } from 'vitest';

import { resolveValuesAlignment, type UserValueProfile } from '../value-profile';

const emptyProfile: UserValueProfile = {
  by_category: {},
  signal_count: {},
  has_value_map: false,
  has_any_leak_signal: false,
};

const lewisLikeProfile: UserValueProfile = {
  by_category: {
    eat_drinking_out: { foundation: 0.7, investment: 0.1, leak: 0.1, burden: 0.1 },
  },
  signal_count: { eat_drinking_out: 12 },
  has_value_map: true,
  has_any_leak_signal: true,
};

const dorcasLikeProfile: UserValueProfile = {
  by_category: {
    eat_drinking_out: { foundation: 0.05, investment: 0.05, leak: 0.8, burden: 0.1 },
    subscriptions: { foundation: 0.1, investment: 0, leak: 0.85, burden: 0.05 },
  },
  signal_count: { eat_drinking_out: 12, subscriptions: 8 },
  has_value_map: true,
  has_any_leak_signal: true,
};

describe('resolveValuesAlignment', () => {
  it('returns 0.25 when target category is dominantly Foundation', () => {
    expect(
      resolveValuesAlignment({
        affects_categories: ['eat_drinking_out'],
        profile: lewisLikeProfile,
      }),
    ).toBe(0.25);
  });

  it('returns 0.95 when target category is dominantly Leak', () => {
    expect(
      resolveValuesAlignment({
        affects_categories: ['eat_drinking_out'],
        profile: dorcasLikeProfile,
      }),
    ).toBe(0.95);
  });

  it('returns 0.5 when the user has no Value Map signal', () => {
    expect(
      resolveValuesAlignment({
        affects_categories: ['eat_drinking_out'],
        profile: emptyProfile,
      }),
    ).toBe(0.5);
  });

  it('returns 0.5 when the template has no affects_categories', () => {
    expect(resolveValuesAlignment({ profile: dorcasLikeProfile })).toBe(0.5);
  });

  it('takes the worst case across multiple tagged categories', () => {
    const mixedProfile: UserValueProfile = {
      by_category: {
        eat_drinking_out: { foundation: 0.7, investment: 0.1, leak: 0.1, burden: 0.1 },
        subscriptions: { foundation: 0.05, investment: 0, leak: 0.9, burden: 0.05 },
      },
      signal_count: { eat_drinking_out: 12, subscriptions: 8 },
      has_value_map: true,
      has_any_leak_signal: true,
    };
    expect(
      resolveValuesAlignment({
        affects_categories: ['eat_drinking_out', 'subscriptions'],
        profile: mixedProfile,
      }),
    ).toBe(0.25);
  });

  it('lifts to leak ceiling when quadrant_intent=leak and the user has any leak signal', () => {
    expect(
      resolveValuesAlignment({
        quadrant_intent: 'leak',
        profile: dorcasLikeProfile,
      }),
    ).toBe(0.85);
  });

  it('does not lift when quadrant_intent=leak but the user has no leak signal', () => {
    const noLeakProfile: UserValueProfile = {
      by_category: {
        eat_drinking_out: { foundation: 1, investment: 0, leak: 0, burden: 0 },
      },
      signal_count: { eat_drinking_out: 5 },
      has_value_map: true,
      has_any_leak_signal: false,
    };
    expect(
      resolveValuesAlignment({
        quadrant_intent: 'leak',
        profile: noLeakProfile,
      }),
    ).toBe(0.5);
  });

  it('resolves DYNAMIC token from resolved_dynamic_category', () => {
    expect(
      resolveValuesAlignment({
        affects_categories: ['DYNAMIC'],
        resolved_dynamic_category: 'eat_drinking_out',
        profile: dorcasLikeProfile,
      }),
    ).toBe(0.95);
  });

  it('treats unresolved DYNAMIC as neutral', () => {
    expect(
      resolveValuesAlignment({
        affects_categories: ['DYNAMIC'],
        profile: dorcasLikeProfile,
      }),
    ).toBe(0.5);
  });

  it('returns 0.5 for mixed-share categories (no quadrant >= 0.5)', () => {
    const mixedShareProfile: UserValueProfile = {
      by_category: {
        eat_drinking_out: { foundation: 0.4, investment: 0.3, leak: 0.2, burden: 0.1 },
      },
      signal_count: { eat_drinking_out: 10 },
      has_value_map: true,
      has_any_leak_signal: true,
    };
    expect(
      resolveValuesAlignment({
        affects_categories: ['eat_drinking_out'],
        profile: mixedShareProfile,
      }),
    ).toBe(0.5);
  });

  it('returns 0.4 when target category is dominantly Investment', () => {
    const investmentProfile: UserValueProfile = {
      by_category: {
        health: { foundation: 0.1, investment: 0.8, leak: 0.05, burden: 0.05 },
      },
      signal_count: { health: 10 },
      has_value_map: true,
      has_any_leak_signal: false,
    };
    expect(
      resolveValuesAlignment({
        affects_categories: ['health'],
        profile: investmentProfile,
      }),
    ).toBe(0.4);
  });

  it('returns 0.75 when target category is dominantly Burden', () => {
    const burdenProfile: UserValueProfile = {
      by_category: {
        debt_repayments: { foundation: 0.05, investment: 0.05, leak: 0.05, burden: 0.85 },
      },
      signal_count: { debt_repayments: 10 },
      has_value_map: true,
      has_any_leak_signal: false,
    };
    expect(
      resolveValuesAlignment({
        affects_categories: ['debt_repayments'],
        profile: burdenProfile,
      }),
    ).toBe(0.75);
  });
});
