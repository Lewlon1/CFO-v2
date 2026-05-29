import { describe, it, expect } from 'vitest'
import { selectHookCandidates } from '../compose-first-read-hooks'
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types'
import type { UserValueProfile } from '@/lib/value-map/value-profile'

// Minimal cluster factory. `total_amount` is signed: negative = spend,
// positive = inflow (income). `mean_amount` follows the same sign so the
// amount profile stays coherent, but the selector keys off total_amount.
function cluster(
  cluster_id: string,
  total_amount: number,
  overrides: Partial<ClusterBehaviour> = {},
): ClusterBehaviour {
  return {
    cluster_type: 'merchant',
    cluster_id,
    window_days: 90,
    data_completeness: 1,
    transaction_count: 12,
    total_amount,
    recurrence: {
      median_interval_days: 7,
      interval_stddev: 1,
      regularity_score: 0.9,
      pattern_label: 'weekly',
      confidence: 0.9,
    },
    trend: {
      slope_amount_per_month: 0,
      slope_percent_per_month: 0,
      direction: 'stable',
      confidence: 0.5,
    },
    time_pattern: {
      weekday_share: 0.8,
      day_of_week_distribution: {},
      dominant_day: 1,
      has_weekday_skew: true,
      confidence: 0.7,
    },
    amount_profile: {
      mean_amount: total_amount / 12,
      stddev_amount: 2,
      coefficient_of_variation: 0.2,
      min_amount: Math.min(0, total_amount),
      max_amount: Math.max(0, total_amount),
      consistency_label: 'fixed',
      confidence: 0.9,
    },
    lifecycle: {
      first_seen: '2026-01-01',
      last_seen: '2026-03-28',
      days_since_last: 3,
      status: 'active',
      appeared_within_window: false,
      confidence: 1,
    },
    summary: '',
    ...overrides,
  }
}

const EMPTY_PROFILE: UserValueProfile = {
  by_category: {},
  signal_count: {},
  by_merchant: {},
  signal_count_by_merchant: {},
  has_value_map: false,
  has_any_leak_signal: false,
}

describe('selectHookCandidates — structural exclusions', () => {
  it('never surfaces income (inflow) or rent/housing as a hook', () => {
    const clusters = [
      cluster('DELOITTE LLP PAYROLL', 11400), // income, inflow
      cluster('GRAINGER PLC RENT', -3150), // housing outflow
      cluster('POS PURCHASE POLLO TROPICAL', -240), // dining, discretionary
      cluster('NETFLIX.COM', -47.97), // streaming, discretionary
    ]
    const hooks = selectHookCandidates(clusters, EMPTY_PROFILE)
    const ids = hooks.map((h) => h.cluster_id)

    expect(ids).not.toContain('DELOITTE LLP PAYROLL')
    expect(ids).not.toContain('GRAINGER PLC RENT')
    expect(ids).toContain('POS PURCHASE POLLO TROPICAL')
    expect(ids).toContain('NETFLIX.COM')
  })

  it('returns no hooks when only income and rent are present (graceful fallback)', () => {
    const clusters = [
      cluster('DELOITTE LLP PAYROLL', 11400),
      cluster('GRAINGER PLC RENT', -3150),
    ]
    expect(selectHookCandidates(clusters, EMPTY_PROFILE)).toEqual([])
  })

  it('excludes transfers (savings pots / bank transfers are not spend)', () => {
    const clusters = [
      cluster('TRANSFER TO POT', -500),
      cluster('POS PURCHASE POLLO TROPICAL', -240),
      cluster('STEAM GAMES', -60),
    ]
    const ids = selectHookCandidates(clusters, EMPTY_PROFILE).map((h) => h.cluster_id)
    expect(ids).not.toContain('TRANSFER TO POT')
    expect(ids).toContain('POS PURCHASE POLLO TROPICAL')
  })
})
