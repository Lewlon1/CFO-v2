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

  it('persists read_recipe when passed', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Here is where your money goes.',
      usableClusters: [],
      goalSummary: null,
      readRecipe: 'visibility',
    });
    expect(md.read_recipe).toBe('visibility');
  });

  it('defaults read_recipe to null and breakdown_cited to false', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'A plain read.',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.read_recipe).toBeNull();
    expect(md.breakdown_cited).toBe(false);
  });

  it('flags breakdown_cited when a top-category slug surfaces in the prose', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Most of your spend is groceries — £450 over the window.',
      usableClusters: [],
      goalSummary: null,
      spendingBreakdown: {
        total_spend: 600,
        window_days: 90,
        top_categories: [{ category: 'groceries', total: 450, pct: 75 }],
        biggest_merchant: { name: 'ALDI', total: 200, txn_count: 8 },
        largest_transaction: { merchant: 'ALDI', amount: 60, date: '2026-04-01' },
        uncategorised_pct: 0,
      },
    });
    expect(md.breakdown_cited).toBe(true);
  });

  it('flags breakdown_cited via the slug spaced form (dining out)', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Your dining out is climbing.',
      usableClusters: [],
      goalSummary: null,
      spendingBreakdown: {
        total_spend: 600,
        window_days: 90,
        top_categories: [{ category: 'dining_out', total: 300, pct: 50 }],
        biggest_merchant: null,
        largest_transaction: null,
        uncategorised_pct: 0,
      },
    });
    expect(md.breakdown_cited).toBe(true);
  });

  it('flags breakdown_cited when the biggest-merchant total appears', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You spent 200 at one place.',
      usableClusters: [],
      goalSummary: null,
      spendingBreakdown: {
        total_spend: 600,
        window_days: 90,
        top_categories: [{ category: 'misc', total: 600, pct: 100 }],
        biggest_merchant: { name: 'ALDI', total: 200, txn_count: 8 },
        largest_transaction: null,
        uncategorised_pct: 0,
      },
    });
    expect(md.breakdown_cited).toBe(true);
  });

  it('does not flag breakdown_cited when the breakdown is absent', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You spent 200 somewhere.',
      usableClusters: [],
      goalSummary: null,
      spendingBreakdown: null,
    });
    expect(md.breakdown_cited).toBe(false);
  });
});
