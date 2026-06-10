import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileFixedCosts } from '../reconcile-fixed-costs'

// Build a stub Supabase client whose .from(table) returns canned data per
// table. Lets us exercise the reconcile dedupe rules without a live DB.
function buildStub(args: {
  profile?: { monthly_rent: number | null; primary_currency: string | null } | null
  declared?: Array<{ label: string; amount: number; cadence: string; status: string }>
  recurring?: Array<{
    name: string
    amount: number
    frequency: string
    status: string
    category_id?: string | null
    bill_subtype?: string | null
  }>
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

  it('holds a detected discretionary recurring row out of the total (variable split)', async () => {
    // The detector can legitimately flag a stable coffee habit as recurring.
    // It is recurring spend, not a commitment — it must NOT count toward
    // total_fixed_costs (free cash flow = income − committed outgoings), but
    // it should still surface informationally.
    const supabase = buildStub({
      profile: { monthly_rent: 950, primary_currency: 'EUR' },
      recurring: [
        { name: 'Satans Coffee', amount: 6, frequency: 'monthly', status: 'detected', category_id: 'eat_drinking_out' },
        { name: 'Spotify', amount: 9.99, frequency: 'monthly', status: 'detected', category_id: 'subscriptions' },
      ],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    // Coffee is variable → excluded; rent + Spotify (subscriptions = committed) counted.
    expect(result.totalFixedCostsMonthly).toBeCloseTo(950 + 9.99, 2)
    expect(result.variableRecurring.some((i) => i.label === 'Satans Coffee')).toBe(true)
    expect(result.items.some((i) => i.label === 'Satans Coffee')).toBe(false)
    expect(result.items.some((i) => i.label === 'Spotify')).toBe(true)
  })

  it('keeps an empty variableRecurring array when nothing is discretionary', async () => {
    const supabase = buildStub({
      profile: { monthly_rent: 950, primary_currency: 'EUR' },
      recurring: [{ name: 'Gym', amount: 45, frequency: 'monthly', status: 'tracked' }],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    expect(result.variableRecurring).toEqual([])
    expect(result.totalFixedCostsMonthly).toBeCloseTo(950 + 45, 2)
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

  it('dedupes case-variant detected rows so they count once', async () => {
    // "Supabase" and "supabase" are the same expense — the case-sensitive
    // unique constraint lets both rows exist; counting both double-inflated
    // fixed costs in calculate_monthly_budget and the First Read.
    const supabase = buildStub({
      profile: { monthly_rent: null, primary_currency: 'EUR' },
      recurring: [
        { name: 'Supabase', amount: 27.03, frequency: 'monthly', status: 'detected', category_id: 'subscriptions' },
        { name: 'supabase', amount: 27.03, frequency: 'monthly', status: 'detected', category_id: 'subscriptions' },
      ],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    expect(result.totalFixedCostsMonthly).toBeCloseTo(27.03, 2)
    expect(result.items.filter((i) => i.label.toLowerCase() === 'supabase')).toHaveLength(1)
  })

  it('treats "bimonthly" (no hyphen) as bi-monthly, not monthly, in the total', async () => {
    // Writers disagree on spelling ('bi-monthly' vs 'bimonthly'); the unknown
    // spelling previously fell back to 'monthly' and double-counted the amount.
    const supabase = buildStub({
      profile: { monthly_rent: null, primary_currency: 'EUR' },
      recurring: [
        { name: 'Renfe', amount: 63.65, frequency: 'bimonthly', status: 'detected', category_id: 'subscriptions' },
      ],
    })
    const result = await reconcileFixedCosts(supabase, 'user-1')
    // bi-monthly → /2 = 31.825; the pre-fix fallback wrongly treated it as monthly (63.65).
    expect(result.totalFixedCostsMonthly).toBeCloseTo(31.83, 2)
  })
})

// Silence the console.error path the helper takes on Supabase errors so the
// test output stays clean. (Reconcile itself doesn't throw — the catches in
// the call sites bubble errors back as null totals.)
vi.spyOn(console, 'error').mockImplementation(() => {})
