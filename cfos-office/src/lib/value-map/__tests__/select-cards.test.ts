import { describe, it, expect } from 'vitest';
import {
  chooseCards,
  computeDivergenceScore,
  windowSince,
  type CandidateMerchant,
} from '../select-cards';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';

function cluster(overrides: Partial<ClusterBehaviour> = {}): ClusterBehaviour {
  return {
    cluster_type: 'merchant',
    cluster_id: 'm',
    window_days: 90,
    data_completeness: 1,
    transaction_count: 10,
    total_amount: -200,
    recurrence: {
      median_interval_days: 7,
      interval_stddev: 1,
      regularity_score: 0.5,
      pattern_label: 'weekly',
      confidence: 0.8,
    },
    trend: {
      slope_amount_per_month: 0,
      slope_percent_per_month: 0,
      direction: 'stable',
      confidence: 0.5,
    },
    time_pattern: {
      weekday_share: 0.5,
      day_of_week_distribution: {},
      dominant_day: null,
      has_weekday_skew: false,
      confidence: 0.5,
    },
    amount_profile: {
      mean_amount: 20,
      stddev_amount: 2,
      coefficient_of_variation: 0.1,
      min_amount: 10,
      max_amount: 30,
      consistency_label: 'tight',
      confidence: 0.8,
    },
    lifecycle: {
      first_seen: '2026-01-01',
      last_seen: '2026-03-01',
      days_since_last: 5,
      status: 'active',
      appeared_within_window: false,
      confidence: 1,
    },
    summary: '',
    ...overrides,
  };
}

function cand(
  key: string,
  spend: number,
  domain: string,
  opts: { meanAmount?: number; cluster?: ClusterBehaviour | null } = {},
): CandidateMerchant {
  return {
    key,
    displayName: key,
    spend,
    txnCount: 5,
    domain,
    meanAmount: opts.meanAmount ?? 20,
    cluster: opts.cluster ?? null,
  };
}

describe('chooseCards', () => {
  it('never selects more than 10 cards', () => {
    // 20 small-spend merchants across many domains so coverage never trips early.
    const candidates = Array.from({ length: 20 }, (_, i) =>
      cand(`m${i}`, 100, `domain${i}`),
    );
    const res = chooseCards(candidates, []);
    expect(res.selectedKeys.length).toBeLessThanOrEqual(10);
  });

  it('always includes the hooks when present', () => {
    const candidates = [
      cand('hookA', 50, 'd1'),
      cand('hookB', 50, 'd2'),
      cand('big', 1000, 'd3'),
    ];
    const res = chooseCards(candidates, ['hookA', 'hookB']);
    expect(res.selectedKeys).toContain('hookA');
    expect(res.selectedKeys).toContain('hookB');
    expect(res.includedHookMerchants).toEqual(['hookA', 'hookB']);
    expect(res.selectionReason['hookA']).toBe('hook');
  });

  it('ranks divergence candidates above low-salience filler', () => {
    // A high-divergence (climbing, big per-txn) merchant vs a flat filler, both
    // similar spend. The divergent one should be picked first with reason
    // 'divergence'; the filler only enters via coverage.
    const climbing = cand('climber', 300, 'd1', {
      meanAmount: 100,
      cluster: cluster({
        transaction_count: 18,
        trend: { slope_amount_per_month: 20, slope_percent_per_month: 40, direction: 'climbing', confidence: 0.9 },
      }),
    });
    const flat = cand('flat', 300, 'd2', { meanAmount: 5, cluster: cluster() });
    const filler = cand('filler', 50, 'd3', { meanAmount: 5, cluster: cluster() });
    const res = chooseCards([climbing, flat, filler], []);
    const climberIdx = res.selectedKeys.indexOf('climber');
    const flatIdx = res.selectedKeys.indexOf('flat');
    expect(climberIdx).toBeGreaterThanOrEqual(0);
    expect(climberIdx).toBeLessThan(flatIdx === -1 ? Infinity : flatIdx);
    expect(res.selectionReason['climber']).toBe('divergence');
  });

  it('halts addition once the coverage floor is met (before reaching 10)', () => {
    // One dominant merchant covers >70% immediately; the rest are tiny.
    const candidates = [
      cand('whale', 800, 'd1'),
      ...Array.from({ length: 9 }, (_, i) => cand(`small${i}`, 10, `d${i + 2}`)),
    ];
    const res = chooseCards(candidates, []);
    expect(res.coverageFraction).toBeGreaterThanOrEqual(0.7);
    expect(res.selectedKeys.length).toBeLessThan(10);
  });

  it('breaks ties toward an unrepresented domain (spread)', () => {
    // Seed a hook in domain "food". Then two equally-divergent candidates: one
    // in "food" (represented), one in "travel" (new). Spread should pick travel
    // first with reason 'spread'.
    const hook = cand('foodHook', 200, 'food', { cluster: cluster() });
    const sameDomain = cand('foodB', 300, 'food', {
      meanAmount: 50,
      cluster: cluster({ transaction_count: 12, trend: { slope_amount_per_month: 10, slope_percent_per_month: 20, direction: 'climbing', confidence: 0.8 } }),
    });
    const newDomain = cand('travelA', 300, 'travel', {
      meanAmount: 50,
      cluster: cluster({ transaction_count: 12, trend: { slope_amount_per_month: 10, slope_percent_per_month: 20, direction: 'climbing', confidence: 0.8 } }),
    });
    const res = chooseCards([hook, sameDomain, newDomain], ['foodHook']);
    const travelIdx = res.selectedKeys.indexOf('travelA');
    const foodBIdx = res.selectedKeys.indexOf('foodB');
    expect(travelIdx).toBeGreaterThanOrEqual(0);
    expect(travelIdx).toBeLessThan(foodBIdx === -1 ? Infinity : foodBIdx);
    expect(res.selectionReason['travelA']).toBe('spread');
  });

  it('returns empty for empty candidates and for zero total spend', () => {
    expect(chooseCards([], ['x']).selectedKeys).toEqual([]);
    expect(chooseCards([cand('a', 0, 'd1'), cand('b', 0, 'd2')], []).selectedKeys).toEqual([]);
  });
});

describe('computeDivergenceScore', () => {
  it('rises with spend share, climbing trend, and per-txn mean', () => {
    const flat = computeDivergenceScore(0.1, cluster(), 0.1);
    const loud = computeDivergenceScore(
      0.6,
      cluster({
        transaction_count: 20,
        trend: { slope_amount_per_month: 30, slope_percent_per_month: 50, direction: 'climbing', confidence: 1 },
      }),
      1,
    );
    expect(loud).toBeGreaterThan(flat);
  });

  it('treats stable/declining trend as no trend contribution', () => {
    const stable = computeDivergenceScore(0.3, cluster({ trend: { slope_amount_per_month: 0, slope_percent_per_month: 0, direction: 'stable', confidence: 1 } }), 0);
    const declining = computeDivergenceScore(0.3, cluster({ trend: { slope_amount_per_month: -5, slope_percent_per_month: -30, direction: 'declining', confidence: 1 } }), 0);
    expect(stable).toBeCloseTo(declining, 5);
  });
});

describe('windowSince', () => {
  it('windows relative to dataWindowEnd, not today', () => {
    expect(windowSince('2026-03-31', 90)).toBe('2025-12-31');
  });

  it('falls back to today when dataWindowEnd is null', () => {
    const since = windowSince(null, 90);
    // 90 days before today — just assert format + that it is in the past.
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(since).getTime()).toBeLessThan(Date.now());
  });
});
