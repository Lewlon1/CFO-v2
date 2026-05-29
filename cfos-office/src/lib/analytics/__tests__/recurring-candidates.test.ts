import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeRecurringCandidates } from '../recurring-candidates'

type TxnRow = {
  id: string
  date: string
  amount: number
  description: string
  category_id: string | null
}

// Stub keyed by table — returns canned { data } and ignores chain filters.
// computeRecurringCandidates reads transactions (via groupRecurringClusters),
// recurring_expenses, and user_declared_fixed_costs.
function buildStub(args: {
  txns?: TxnRow[]
  recurring?: Array<{ name: string; status: string }>
  declared?: Array<{ label: string; status: string }>
}): SupabaseClient {
  const tableData: Record<string, { data: unknown }> = {
    transactions: { data: args.txns ?? [] },
    recurring_expenses: { data: args.recurring ?? [] },
    user_declared_fixed_costs: { data: args.declared ?? [] },
  }
  const client = {
    from(table: string) {
      const payload = tableData[table] ?? { data: [] }
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(payload)
            return () => proxy
          },
        },
      )
      return proxy
    },
  } as unknown as SupabaseClient
  return client
}

describe('computeRecurringCandidates', () => {
  it('surfaces a 2× identical committed-category cluster as a high-confidence candidate', async () => {
    // TMB (Barcelona metro pass) — €45.50 in Jan and Feb. Fails strict (only
    // 2 occurrences) but is a clear commitment.
    const supabase = buildStub({
      txns: [
        { id: 't1', date: '2026-01-12', amount: -45.5, description: 'TMB', category_id: 'transport' },
        { id: 't2', date: '2026-02-12', amount: -45.5, description: 'TMB', category_id: 'transport' },
      ],
    })
    const candidates = await computeRecurringCandidates(supabase, 'u1')
    const tmb = candidates.find((c) => c.name === 'tmb')
    expect(tmb).toBeDefined()
    expect(tmb!.confidence).toBe('high')
    expect(tmb!.occurrences).toBe(2)
    expect(tmb!.cadence).toBe('monthly')
    expect(tmb!.amount).toBeCloseTo(45.5, 2)
    expect(tmb!.monthly_equivalent).toBeCloseTo(45.5, 2)
  })

  it('excludes a 3× steady cluster — it passes strict, so it is detected not a candidate', async () => {
    const supabase = buildStub({
      txns: [
        { id: 's1', date: '2026-01-05', amount: -9.99, description: 'Spotify', category_id: 'subscriptions' },
        { id: 's2', date: '2026-02-05', amount: -9.99, description: 'Spotify', category_id: 'subscriptions' },
        { id: 's3', date: '2026-03-05', amount: -9.99, description: 'Spotify', category_id: 'subscriptions' },
      ],
    })
    const candidates = await computeRecurringCandidates(supabase, 'u1')
    expect(candidates.find((c) => c.name === 'spotify')).toBeUndefined()
  })

  it('excludes discretionary-category clusters (groceries are spend, not a commitment)', async () => {
    const supabase = buildStub({
      txns: [
        { id: 'g1', date: '2026-01-10', amount: -50, description: 'Mercadona', category_id: 'groceries' },
        { id: 'g2', date: '2026-02-10', amount: -50, description: 'Mercadona', category_id: 'groceries' },
      ],
    })
    const candidates = await computeRecurringCandidates(supabase, 'u1')
    expect(candidates.find((c) => c.name === 'mercadona')).toBeUndefined()
  })

  it('does not re-offer a name already dismissed in recurring_expenses', async () => {
    const supabase = buildStub({
      txns: [
        { id: 't1', date: '2026-01-12', amount: -45.5, description: 'TMB', category_id: 'transport' },
        { id: 't2', date: '2026-02-12', amount: -45.5, description: 'TMB', category_id: 'transport' },
      ],
      recurring: [{ name: 'tmb', status: 'dismissed' }],
    })
    const candidates = await computeRecurringCandidates(supabase, 'u1')
    expect(candidates.find((c) => c.name === 'tmb')).toBeUndefined()
  })

  it('does not re-offer a name already declared (non-dismissed) by the user', async () => {
    const supabase = buildStub({
      txns: [
        { id: 't1', date: '2026-01-12', amount: -45.5, description: 'TMB', category_id: 'transport' },
        { id: 't2', date: '2026-02-12', amount: -45.5, description: 'TMB', category_id: 'transport' },
      ],
      declared: [{ label: 'TMB', status: 'confirmed' }],
    })
    const candidates = await computeRecurringCandidates(supabase, 'u1')
    expect(candidates.find((c) => c.name === 'tmb')).toBeUndefined()
  })

  it('surfaces an irregular, variable-amount many-charge cluster (Claude-shaped) as low-confidence', async () => {
    const supabase = buildStub({
      txns: [
        { id: 'c1', date: '2026-01-01', amount: -20, description: 'Claude.ai', category_id: 'subscriptions' },
        { id: 'c2', date: '2026-01-21', amount: -49, description: 'Claude.ai', category_id: 'subscriptions' },
        { id: 'c3', date: '2026-02-14', amount: -30, description: 'Claude.ai', category_id: 'subscriptions' },
        { id: 'c4', date: '2026-03-08', amount: -61, description: 'Claude.ai', category_id: 'subscriptions' },
      ],
    })
    const candidates = await computeRecurringCandidates(supabase, 'u1')
    const claude = candidates.find((c) => c.name === 'claude.ai')
    expect(claude).toBeDefined()
    expect(claude!.confidence).toBe('low')
    expect(claude!.occurrences).toBe(4)
  })

  it('excludes a 2× cluster confined to a single month (does not span time → not recurring)', async () => {
    const supabase = buildStub({
      txns: [
        { id: 'f1', date: '2026-01-05', amount: -30, description: 'Foo Club', category_id: 'transport' },
        { id: 'f2', date: '2026-01-25', amount: -30, description: 'Foo Club', category_id: 'transport' },
      ],
    })
    const candidates = await computeRecurringCandidates(supabase, 'u1')
    expect(candidates.find((c) => c.name === 'foo club')).toBeUndefined()
  })
})

// Reconcile/candidate helpers log on Supabase errors; silence to keep output clean.
vi.spyOn(console, 'error').mockImplementation(() => {})
