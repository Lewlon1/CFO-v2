import { describe, it, expect } from 'vitest'
import { buildBandReconciliation, buildDeclaredDelta } from '../compose-first-read'
import type { ReconciledBill } from '@/lib/analytics/reconcile-fixed-costs'

// Minimal ReconciledBill factory — only the fields the reconciler reads.
function bill(over: Partial<ReconciledBill> & Pick<ReconciledBill, 'label' | 'source'>): ReconciledBill {
  return {
    amount: over.monthly_equivalent ?? 0,
    cadence: 'monthly',
    monthly_equivalent: 0,
    matched_detected: false,
    observed_monthly_equivalent: null,
    superseded: false,
    benchmark_verdict: null,
    bill_subtype: null,
    ...over,
  } as ReconciledBill
}

describe('buildBandReconciliation', () => {
  it('names a miss in each direction with both sides and a signed diff', () => {
    const { bands } = buildBandReconciliation([
      // Declared low — the statements show more. They underestimated.
      bill({
        label: 'Broadband',
        source: 'declared',
        monthly_equivalent: 35,
        observed_monthly_equivalent: 61,
        matched_detected: true,
      }),
      // Declared high — the statements show less. They overestimated.
      bill({
        label: 'Gym',
        source: 'declared',
        monthly_equivalent: 90,
        observed_monthly_equivalent: 48,
        matched_detected: true,
      }),
    ])

    // Sorted by absolute size: the gym miss (42) outranks broadband (26).
    expect(bands.map((b) => b.label)).toEqual(['Gym', 'Broadband'])
    expect(bands[0]).toMatchObject({
      label: 'Gym',
      declared: 90,
      observed: 48,
      diff: -42,
      direction: 'overestimated',
    })
    expect(bands[1]).toMatchObject({
      label: 'Broadband',
      declared: 35,
      observed: 61,
      diff: 26,
      direction: 'underestimated',
    })
  })

  it('treats a sub-floor difference as noise, not a finding', () => {
    const { bands } = buildBandReconciliation([
      bill({
        label: 'Phone',
        source: 'declared',
        monthly_equivalent: 30,
        observed_monthly_equivalent: 33, // £3 — under the £5 floor
        matched_detected: true,
      }),
    ])
    expect(bands).toEqual([])
  })

  it('separates declared-but-unmatched (still estimates) from detected-but-undeclared', () => {
    const { bands, unverified, undeclared } = buildBandReconciliation([
      bill({ label: 'Council tax', source: 'declared', monthly_equivalent: 180 }),
      bill({ label: 'Home insurance', source: 'declared', monthly_equivalent: 22 }),
      bill({ label: 'Spotify', source: 'detected', monthly_equivalent: 11 }),
    ])
    expect(bands).toEqual([])
    expect(unverified).toEqual(['Council tax', 'Home insurance'])
    expect(undeclared).toEqual(['Spotify'])
  })

  it('excludes the profile rent line — it has no estimate/observation pair', () => {
    const r = buildBandReconciliation([
      bill({ label: 'Housing', source: 'rent', monthly_equivalent: 1100 }),
    ])
    expect(r).toEqual({ bands: [], unverified: [], undeclared: [] })
  })

  it('ignores superseded dedupe losers entirely', () => {
    const { bands, unverified } = buildBandReconciliation([
      bill({
        label: 'Rent (duplicate)',
        source: 'declared',
        monthly_equivalent: 1100,
        superseded: true,
      }),
    ])
    expect(bands).toEqual([])
    expect(unverified).toEqual([])
  })
})

describe('buildDeclaredDelta with band reconciliation', () => {
  const declared = { totalFixedCosts: 1850, freeCash: 1250, currency: 'EUR' }
  const actual = { total_fixed_costs: 2140, free_cash_flow: 960 }

  it('carries the bands alongside the aggregate delta', () => {
    const delta = buildDeclaredDelta(declared, actual, [
      bill({
        label: 'Broadband',
        source: 'declared',
        monthly_equivalent: 35,
        observed_monthly_equivalent: 61,
        matched_detected: true,
      }),
    ])
    expect(delta).not.toBeNull()
    expect(delta!.fixedCostsDiff).toBe(290)
    expect(delta!.bands).toHaveLength(1)
    expect(delta!.bands[0].label).toBe('Broadband')
  })

  it('defaults to empty band lists when no reconciled items are passed', () => {
    // The upgrade path degrades to the aggregate delta if reconcile throws —
    // that must not produce undefined lists downstream.
    const delta = buildDeclaredDelta(declared, actual)
    expect(delta!.bands).toEqual([])
    expect(delta!.unverified).toEqual([])
    expect(delta!.undeclared).toEqual([])
  })

  it('still returns null when neither actual figure exists', () => {
    expect(
      buildDeclaredDelta(declared, { total_fixed_costs: null, free_cash_flow: null }, []),
    ).toBeNull()
  })
})
