import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { flagAgainstBenchmark } from '@/lib/analytics/flag-against-benchmark'
import type { FlagInput } from '@/lib/analytics/flag-against-benchmark'

/**
 * Minimal mock of the SupabaseClient surface the flagger touches: a single
 * chained query on `benchmark_reference` ending in `.maybeSingle()`. The
 * factory returns a client that yields the supplied row regardless of the
 * exact filters — assertions about the called filters happen separately.
 */
function mockClient(row: {
  band_low: number | null
  band_high: number | null
  currency: string
  basis: string
  source: string
} | null): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: row, error: null }),
  }
  return {
    from: () => builder,
  } as unknown as SupabaseClient
}

const baseBill: FlagInput = {
  label: 'Broadband',
  amount: 45,
  cadence: 'monthly',
  source: 'declared',
  bill_subtype: 'broadband',
}

describe('flagAgainstBenchmark — verdict computation', () => {
  it('returns verdict "above" when monthly equivalent exceeds band_high', async () => {
    const client = mockClient({
      band_low: 25,
      band_high: 35,
      currency: 'GBP',
      basis: 'single household',
      source: 'Ofcom',
    })
    const verdict = await flagAgainstBenchmark(client, baseBill, 'GB')
    expect(verdict).not.toBeNull()
    expect(verdict?.verdict).toBe('above')
    expect(verdict?.band_low).toBe(25)
    expect(verdict?.band_high).toBe(35)
    expect(verdict?.currency).toBe('GBP')
    expect(verdict?.source).toBe('Ofcom')
    expect(verdict?.country).toBe('GB')
  })

  it('returns verdict "within" when monthly equivalent sits inside the band', async () => {
    const client = mockClient({
      band_low: 25,
      band_high: 35,
      currency: 'GBP',
      basis: 'x',
      source: 'Ofcom',
    })
    const verdict = await flagAgainstBenchmark(
      client,
      { ...baseBill, amount: 30 },
      'GB',
    )
    expect(verdict?.verdict).toBe('within')
  })

  it('returns verdict "below" when monthly equivalent is below band_low', async () => {
    const client = mockClient({
      band_low: 25,
      band_high: 35,
      currency: 'GBP',
      basis: 'x',
      source: 'Ofcom',
    })
    const verdict = await flagAgainstBenchmark(
      client,
      { ...baseBill, amount: 18 },
      'GB',
    )
    expect(verdict?.verdict).toBe('below')
  })

  it('converts non-monthly cadences to monthly equivalent before comparing', async () => {
    const client = mockClient({
      band_low: 25,
      band_high: 35,
      currency: 'GBP',
      basis: 'x',
      source: 'Ofcom',
    })
    // £600/year ≈ £50/month → above band_high (£35)
    const verdict = await flagAgainstBenchmark(
      client,
      { ...baseBill, amount: 600, cadence: 'annual' },
      'GB',
    )
    expect(verdict?.verdict).toBe('above')
  })

  it('parses numeric values returned as strings (Supabase NUMERIC clients)', async () => {
    const client = mockClient({
      band_low: '25' as unknown as number,
      band_high: '35' as unknown as number,
      currency: 'GBP',
      basis: 'x',
      source: 'Ofcom',
    })
    const verdict = await flagAgainstBenchmark(client, baseBill, 'GB')
    expect(verdict?.verdict).toBe('above')
    expect(verdict?.band_low).toBe(25)
    expect(verdict?.band_high).toBe(35)
  })
})

describe('flagAgainstBenchmark — silence cases (the safe default)', () => {
  it('returns null when bill_subtype is null', async () => {
    const client = mockClient({
      band_low: 25,
      band_high: 35,
      currency: 'GBP',
      basis: 'x',
      source: 'Ofcom',
    })
    const verdict = await flagAgainstBenchmark(
      client,
      { ...baseBill, bill_subtype: null },
      'GB',
    )
    expect(verdict).toBeNull()
  })

  it('returns null when country is null', async () => {
    const client = mockClient({
      band_low: 25,
      band_high: 35,
      currency: 'GBP',
      basis: 'x',
      source: 'Ofcom',
    })
    const verdict = await flagAgainstBenchmark(client, baseBill, null)
    expect(verdict).toBeNull()
  })

  it('returns null when country is outside the benchmark allowlist', async () => {
    const client = mockClient({
      band_low: 25,
      band_high: 35,
      currency: 'GBP',
      basis: 'x',
      source: 'Ofcom',
    })
    const verdict = await flagAgainstBenchmark(client, baseBill, 'US')
    expect(verdict).toBeNull()
  })

  it('returns null when no row matches', async () => {
    const client = mockClient(null)
    const verdict = await flagAgainstBenchmark(client, baseBill, 'GB')
    expect(verdict).toBeNull()
  })

  it('returns null when the band is unsourced (band_low is null)', async () => {
    const client = mockClient({
      band_low: null,
      band_high: null,
      currency: 'GBP',
      basis: 'x',
      source: 'TODO: Ofcom Pricing Trends',
    })
    const verdict = await flagAgainstBenchmark(client, baseBill, 'GB')
    expect(verdict).toBeNull()
  })

  it('returns null when only one bound is sourced (defensive — schema CHECK prevents this in DB)', async () => {
    const client = mockClient({
      band_low: 25,
      band_high: null,
      currency: 'GBP',
      basis: 'x',
      source: 'Ofcom',
    })
    const verdict = await flagAgainstBenchmark(client, baseBill, 'GB')
    expect(verdict).toBeNull()
  })
})
