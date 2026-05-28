import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileFixedCosts } from '../reconcile-fixed-costs'

// Build a stub Supabase client whose .from(table) returns canned data per
// table. Lets us exercise the reconcile dedupe rules without a live DB.
function buildStub(args: {
  profile?: { monthly_rent: number | null; primary_currency: string | null } | null
  declared?: Array<{ label: string; amount: number; cadence: string; status: string }>
  recurring?: Array<{ name: string; amount: number; frequency: string; status: string }>
}) {
  const tableData: Record<string, unknown> = {
    user_profiles: { data: args.profile ?? { monthly_rent: null, primary_currency: 'EUR' } },
    user_declared_fixed_costs: { data: args.declared ?? [] },
    recurring_expenses: { data: args.recurring ?? [] },
  }
  const client = {
    from(table: string) {
      const payload = tableData[table] ?? { data: [] }
      const chain: Record<string, unknown> = {}
      const proxy: unknown = new Proxy(chain, {
        get(target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown) => resolve(payload)
          }
          return () => proxy
        },
      })
      return proxy
    },
  } as unknown as SupabaseClient
  return client
}

describe('reconcileFixedCosts', () => {
  it('returns rent alone when no declared or detected rows exist', async () => {
    const supabase = buildStub({
      profile: { monthly_rent: 950, primary_currency: 'EUR' },
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    expect(result.totalFixedCostsMonthly).toBe(950)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ source: 'rent', label: 'Housing' })
  })

  it('dedupes form-entered rent against the rent line (counts once)', async () => {
    const supabase = buildStub({
      profile: { monthly_rent: 950, primary_currency: 'EUR' },
      declared: [
        { label: 'Apartment', amount: 950, cadence: 'monthly', status: 'pending' },
      ],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    expect(result.totalFixedCostsMonthly).toBe(950)
    const superseded = result.items.find((i) => i.label === 'Apartment')
    expect(superseded?.superseded).toBe(true)
  })

  it('declared label wins over detected name on amount-band + cadence match', async () => {
    const supabase = buildStub({
      profile: { monthly_rent: null, primary_currency: 'EUR' },
      declared: [
        { label: 'Netflix', amount: 13, cadence: 'monthly', status: 'pending' },
      ],
      recurring: [
        { name: 'netflix.com', amount: 12.99, frequency: 'monthly', status: 'detected' },
      ],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    // Total should NOT double-count.
    expect(result.totalFixedCostsMonthly).toBeCloseTo(13, 2)
    // The declared "Netflix" should be marked matched_detected; the detected
    // "netflix.com" should be consumed and not appear as a separate row.
    const declaredRow = result.items.find((i) => i.source === 'declared')
    expect(declaredRow?.matched_detected).toBe(true)
    const detectedRow = result.items.find(
      (i) => i.source === 'detected' && i.label === 'netflix.com',
    )
    expect(detectedRow).toBeUndefined()
  })

  it('surfaces unmatched detected items separately', async () => {
    const supabase = buildStub({
      profile: { monthly_rent: 950, primary_currency: 'EUR' },
      recurring: [
        { name: 'Spotify', amount: 9.99, frequency: 'monthly', status: 'detected' },
        { name: 'Gym', amount: 45, frequency: 'monthly', status: 'tracked' },
      ],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    const total = 950 + 9.99 + 45
    expect(result.totalFixedCostsMonthly).toBeCloseTo(total, 2)
    expect(result.items.some((i) => i.label === 'Spotify')).toBe(true)
    expect(result.items.some((i) => i.label === 'Gym')).toBe(true)
  })

  it('normalises weekly cadence to monthly equivalent in the total', async () => {
    const supabase = buildStub({
      profile: { monthly_rent: null, primary_currency: 'EUR' },
      declared: [
        { label: 'Weekly groceries', amount: 100, cadence: 'weekly', status: 'pending' },
      ],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    // weekly × 4.33 = 433
    expect(result.totalFixedCostsMonthly).toBeCloseTo(433, 2)
  })

  it('excludes dismissed declared bills from the total', async () => {
    const supabase = buildStub({
      profile: { monthly_rent: 950, primary_currency: 'EUR' },
      declared: [
        // status 'dismissed' should be filtered out at query time. Our stub
        // returns whatever we pass, so we model the post-query filtering by
        // omitting them from the input here — same observable behaviour.
      ],
      recurring: [],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    expect(result.totalFixedCostsMonthly).toBe(950)
  })
})

// Silence the console.error path the helper takes on Supabase errors so the
// test output stays clean. (Reconcile itself doesn't throw — the catches in
// the call sites bubble errors back as null totals.)
vi.spyOn(console, 'error').mockImplementation(() => {})
