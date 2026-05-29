import { describe, it, expect } from 'vitest';
import { extractCompositionMetadata } from '../compose-first-read';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';

function mockCluster(name: string): ClusterBehaviour {
  return {
    cluster_type: 'merchant',
    cluster_id: name,
    window_days: 90,
    data_completeness: 1,
    transaction_count: 14,
    total_amount: -117.6,
    recurrence: {
      median_interval_days: 6,
      interval_stddev: 1,
      regularity_score: 0.8,
      pattern_label: 'weekly',
      confidence: 0.9,
    },
    trend: {
      slope_amount_per_month: 5,
      slope_percent_per_month: 18,
      direction: 'climbing',
      confidence: 0.7,
    },
    time_pattern: {
      weekday_share: 0.85,
      day_of_week_distribution: { 0: 0, 1: 0.1, 2: 0.2, 3: 0.5, 4: 0.1, 5: 0.1, 6: 0 },
      dominant_day: 3,
      has_weekday_skew: true,
      confidence: 0.8,
    },
    amount_profile: {
      mean_amount: 8.4,
      stddev_amount: 3,
      coefficient_of_variation: 0.36,
      min_amount: 4,
      max_amount: 18,
      consistency_label: 'variable',
      confidence: 0.9,
    },
    lifecycle: {
      first_seen: '2026-02-01',
      last_seen: '2026-04-25',
      days_since_last: 4,
      status: 'active',
      appeared_within_window: false,
      confidence: 1,
    },
    summary: 'placeholder summary',
  };
}

describe('extractCompositionMetadata', () => {
  it('detects trend citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Your **Pollo Tropical** spending is climbing 18% a month.',
      usableClusters: [mockCluster('POS PURCHASE POLLO TROPICAL #142')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('trend');
  });

  it('detects recurrence citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: '**Pret** every 6 days like clockwork.',
      usableClusters: [mockCluster('POS PURCHASE Pret')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('recurrence');
  });

  it('detects time_pattern citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Mostly weekday mornings at **Starbucks**.',
      usableClusters: [mockCluster('POS PURCHASE Starbucks')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('time_pattern');
  });

  it('detects lifecycle citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: '**iCloud** first appeared in April.',
      usableClusters: [mockCluster('POS PURCHASE iCloud')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('lifecycle');
  });

  it('detects amount_profile citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: '**Pollo Tropical** — mean £8.40, range £4–£18.',
      usableClusters: [mockCluster('POS PURCHASE POLLO TROPICAL #142')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('amount_profile');
  });

  it('flags gap_present when Value Map quadrant and divergence are both named', () => {
    const md = extractCompositionMetadata({
      composedMessage:
        'You called dining a Leak in the Value Map. It is climbing 18% a month. What is changing?',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.gap_present).toBe(true);
  });

  it('does not flag gap_present for plain observations', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You have 233 transactions across 90 days.',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.gap_present).toBe(false);
  });

  it('includes L5 when goalSummary present', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You have a clear plan.',
      usableClusters: [],
      goalSummary: 'Clear the debt · target 15000 · by 2030-05-18',
    });
    expect(md.layers_used).toContain('L5');
  });

  it('omits L5 when no goal', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You have 233 transactions.',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.layers_used).not.toContain('L5');
  });

  it('always includes L1, L2, L3', () => {
    const md = extractCompositionMetadata({
      composedMessage: '',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.layers_used).toEqual(['L1', 'L2', 'L3']);
  });

  it('detects clusters_referenced by normalised brand probe', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Your **POLLO TROPICAL** spending climbed in March.',
      usableClusters: [mockCluster('POS PURCHASE POLLO TROPICAL #142')],
      goalSummary: null,
    });
    expect(md.clusters_referenced.length).toBeGreaterThan(0);
  });
});
