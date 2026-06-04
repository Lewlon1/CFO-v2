import { describe, it, expect } from 'vitest';
import { chooseSignificantMerchant } from '../significant-merchant';
import type { CandidateMerchant } from '../select-cards';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';
import type { ValueQuadrant } from '../types';

function cluster(overrides: Partial<ClusterBehaviour> = {}): ClusterBehaviour {
  return {
    cluster_type: 'merchant',
    cluster_id: 'm',
    window_days: 90,
    data_completeness: 1,
    transaction_count: 12,
    total_amount: -300,
    recurrence: {
      median_interval_days: 7,
      interval_stddev: 1,
      regularity_score: 0.7,
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
      mean_amount: 25,
      stddev_amount: 3,
      coefficient_of_variation: 0.12,
      min_amount: 10,
      max_amount: 40,
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
  opts: { meanAmount?: number; cluster?: ClusterBehaviour | null } = {},
): CandidateMerchant {
  return {
    key,
    displayName: key,
    spend,
    txnCount: 12,
    domain: 'd',
    meanAmount: opts.meanAmount ?? 25,
    cluster: opts.cluster === undefined ? cluster() : opts.cluster,
  };
}

const noQuadrants: Record<string, Record<ValueQuadrant, number>> = {};

describe('chooseSignificantMerchant', () => {
  it('prefers a high-salience low-confidence merchant over a high-confidence one', () => {
    const lowConf = cand('uber', 600, {
      meanAmount: 60,
      cluster: cluster({ transaction_count: 18, trend: { slope_amount_per_month: 10, slope_percent_per_month: 25, direction: 'climbing', confidence: 0.9 } }),
    });
    const highConf = cand('rent', 400);
    const conf = new Map<string, number>([
      ['uber', 2], // low confidence → ambiguous
      ['rent', 5], // high confidence → not ambiguous
    ]);
    const res = chooseSignificantMerchant([lowConf, highConf], noQuadrants, conf);
    expect(res?.merchantKey).toBe('uber');
    expect(res?.userConfidence).toBe(2);
  });

  it('prefers a salient divergent merchant over a high-confidence low-salience one', () => {
    // tesco: stated Foundation but climbing fast → divergence, high salience.
    const tesco = cand('tesco', 700, {
      meanAmount: 70,
      cluster: cluster({ transaction_count: 20, trend: { slope_amount_per_month: 30, slope_percent_per_month: 40, direction: 'climbing', confidence: 0.9 } }),
    });
    const tiny = cand('spotify', 30);
    const byMerchant: Record<string, Record<ValueQuadrant, number>> = {
      tesco: { foundation: 1, investment: 0, leak: 0, burden: 0 },
    };
    const conf = new Map<string, number>([
      ['tesco', 5], // confident, but the behaviour diverges
      ['spotify', 5],
    ]);
    const res = chooseSignificantMerchant([tesco, tiny], byMerchant, conf);
    expect(res?.merchantKey).toBe('tesco');
    expect(res?.likelyDivergence).toBe(true);
  });

  it('returns null when nothing clears the salience floor', () => {
    // Many equal-spend, flat (no trend/freq/mean) candidates → each spend share
    // is small and there is no behavioural loudness, so none clears MIN_SALIENCE.
    const flat = Array.from({ length: 12 }, (_, i) =>
      cand(`m${i}`, 100, { meanAmount: 0, cluster: null }),
    );
    const res = chooseSignificantMerchant(flat, noQuadrants, new Map());
    expect(res).toBeNull();
  });

  it('returns null for an empty candidate set', () => {
    expect(chooseSignificantMerchant([], noQuadrants, new Map())).toBeNull();
  });

  it('treats an unsorted but salient merchant as ambiguous', () => {
    const big = cand('newmerchant', 800, {
      meanAmount: 80,
      cluster: cluster({ transaction_count: 16, trend: { slope_amount_per_month: 5, slope_percent_per_month: 20, direction: 'climbing', confidence: 0.8 } }),
    });
    // No confidence entry → unsorted → ambiguous.
    const res = chooseSignificantMerchant([big], noQuadrants, new Map());
    expect(res?.merchantKey).toBe('newmerchant');
    expect(res?.userConfidence).toBeNull();
  });
});
