import { describe, it, expect } from 'vitest';
import { composeSummary } from '../summary';
import type { ClusterBehaviour } from '../types';

// A daily-habit cluster with a typical spend of 24.61 (stored negative, as all
// spend is in this codebase). The summary must render the user's currency and a
// positive spend magnitude — not a hardcoded "£" and not "-£24.61".
function baseBehaviour(meanAmount: number): Omit<ClusterBehaviour, 'summary'> {
  return {
    cluster_type: 'category',
    cluster_id: 'eat_drinking_out',
    window_days: 90,
    data_completeness: 1,
    transaction_count: 24,
    total_amount: meanAmount * 24,
    recurrence: {
      median_interval_days: 1,
      interval_stddev: 0.5,
      regularity_score: 0.9,
      pattern_label: 'daily',
      confidence: 0.9,
    },
    trend: { slope_amount_per_month: 0, slope_percent_per_month: 0, direction: 'stable', confidence: 0.5 },
    time_pattern: {
      weekday_share: 0.6,
      day_of_week_distribution: {},
      dominant_day: null,
      has_weekday_skew: false,
      confidence: 0.5,
    },
    amount_profile: {
      mean_amount: meanAmount,
      stddev_amount: 5,
      coefficient_of_variation: 0.2,
      min_amount: meanAmount - 10,
      max_amount: meanAmount + 10,
      consistency_label: 'variable',
      confidence: 0.8,
    },
    lifecycle: {
      first_seen: '2026-03-01',
      last_seen: '2026-05-30',
      days_since_last: 7,
      status: 'active',
      appeared_within_window: false,
      confidence: 0.9,
    },
  };
}

describe('composeSummary — currency + sign', () => {
  it('renders the user currency (EUR) and a positive magnitude, not a hardcoded £/negative', () => {
    const summary = composeSummary(baseBehaviour(-24.61), 'EUR');
    expect(summary).toContain('mean €24.61');
    expect(summary).not.toContain('£');
    expect(summary).not.toContain('-€');
  });

  it('uses £ for GBP and $ for USD', () => {
    expect(composeSummary(baseBehaviour(-24.61), 'GBP')).toContain('mean £24.61');
    expect(composeSummary(baseBehaviour(-24.61), 'USD')).toContain('mean $24.61');
  });

  it('keeps the k-suffix formatting for large magnitudes', () => {
    expect(composeSummary(baseBehaviour(-1234.5), 'EUR')).toContain('mean €1.2k');
  });

  it('defaults to EUR when no currency is given', () => {
    expect(composeSummary(baseBehaviour(-24.61))).toContain('mean €24.61');
  });
});
