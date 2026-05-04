import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateWowMomentCandidate } from '../candidate-engine'

// Tiny chainable stub that resolves to whatever value is supplied per table
// for the specific method chain we hit. Sufficient for the candidate engine's
// query shapes; not a generic Supabase mock.
function buildMockClient(tableHandlers: Record<string, () => Promise<{ data: unknown }>>): SupabaseClient {
  const stubFor = (table: string) => {
    const handler = tableHandlers[table]
    if (!handler) {
      throw new Error(`Unmocked table: ${table}`)
    }
    const proxy: Record<string, unknown> = {}
    const passthrough = ['select', 'eq', 'in', 'is', 'gte', 'order', 'limit']
    for (const m of passthrough) {
      proxy[m] = () => proxy
    }
    proxy.maybeSingle = () => handler()
    proxy.then = (
      onFulfilled: (value: { data: unknown }) => unknown,
      onRejected?: (err: unknown) => unknown,
    ) => handler().then(onFulfilled, onRejected)
    return proxy
  }
  return { from: (table: string) => stubFor(table) } as unknown as SupabaseClient
}

describe('generateWowMomentCandidate', () => {
  it('returns null when a prior active_experiments row exists for the user', async () => {
    const client = buildMockClient({
      active_experiments: () => Promise.resolve({ data: [{ id: 'prior' }] }),
    })
    const result = await generateWowMomentCandidate('u1', client)
    expect(result).toBeNull()
  })

  it('returns null when there are fewer than 30 transactions in 90 days', async () => {
    const client = buildMockClient({
      active_experiments: () => Promise.resolve({ data: [] }),
      transactions: () =>
        Promise.resolve({
          data: Array.from({ length: 12 }, (_, i) => ({
            id: `tx${i}`,
            date: '2026-04-01T00:00:00Z',
            description: 'PRET',
            amount: -5,
            category_id: null,
            value_category: 'leak',
          })),
        }),
    })
    const result = await generateWowMomentCandidate('u1', client)
    expect(result).toBeNull()
  })

  it('returns the top-scoring candidate when at least one detector fires', async () => {
    const transactions = Array.from({ length: 60 }, (_, i) => ({
      id: `tx${i}`,
      date: '2026-04-01T00:00:00Z',
      description: 'PRET A MANGER',
      amount: -5,
      category_id: null,
      value_category: 'leak',
    }))
    const client = buildMockClient({
      active_experiments: () => Promise.resolve({ data: [] }),
      transactions: () => Promise.resolve({ data: transactions }),
      categories: () => Promise.resolve({ data: [] }),
      user_profiles: () => Promise.resolve({ data: { primary_currency: 'GBP', country: 'GB' } }),
      value_map_sessions: () => Promise.resolve({ data: { archetype_name: 'truth_teller' } }),
    })
    const result = await generateWowMomentCandidate('u1', client)
    expect(result).not.toBeNull()
    expect(result?.observation_type).toBe('high_freq_merchant')
    expect(result?.pattern_template_key).toBe('rhythm')
    expect(result?.payload.merchant_name).toMatch(/Pret/i)
  })
})
