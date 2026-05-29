import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared recorders, hoisted so the vi.mock factories below can close over them.
const { calls, order } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; value?: unknown; opts?: unknown; col?: string; vals?: unknown }>,
  order: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        in: (col: string, vals: unknown) => {
          calls.push({ table, method: 'in', col, vals })
          return b
        },
        single: async () => ({ data: { primary_currency: 'EUR' } }),
        update: (value: unknown) => {
          calls.push({ table, method: 'update', value })
          return b
        },
        insert: async (value: unknown) => {
          calls.push({ table, method: 'insert', value })
          return { error: null }
        },
        upsert: async (value: unknown, opts: unknown) => {
          calls.push({ table, method: 'upsert', value, opts })
          return { error: null }
        },
        then: (resolve: (x: unknown) => unknown) => resolve({ error: null }),
      })
      return b
    },
  })),
}))
vi.mock('@/app/onboarding-v2/actions-step', () => ({
  advanceStep: vi.fn(async () => {
    order.push('advance')
  }),
}))
vi.mock('@/lib/analytics/monthly-snapshot', () => ({
  syncTotalFixedCosts: vi.fn(async () => {
    order.push('sync')
  }),
}))

import { confirmFixedCosts } from '../confirm-actions'

function find(table: string, method: string) {
  return calls.filter((c) => c.table === table && c.method === method)
}

beforeEach(() => {
  calls.length = 0
  order.length = 0
  vi.clearAllMocks()
})

describe('confirmFixedCosts — batched ConfirmPayload commit', () => {
  it('persists every touched decision in one commit and routes to the First Read', async () => {
    const result = await confirmFixedCosts({
      declaredDismissals: ['Old Gym'],
      detectedDismissals: ['netflix'],
      acceptedCandidates: [{ name: 'tmb', amount: 45.5, cadence: 'monthly', bill_subtype: null }],
      skippedCandidates: [{ name: 'shell', amount: 37, cadence: 'monthly' }],
      declaredLines: [{ label: 'Electricity', amount: 90, cadence: 'bi-monthly', bill_subtype: 'electricity' }],
    })

    expect(result.redirectTo).toBe('/onboarding-v2/first-read')

    // Detected drops → recurring_expenses dismissed, matched on name.
    expect(find('recurring_expenses', 'update')[0]?.value).toMatchObject({ status: 'dismissed' })
    expect(find('recurring_expenses', 'in').some((c) => c.col === 'name')).toBe(true)

    // Declared drops → user_declared_fixed_costs dismissed, matched on label.
    expect(find('user_declared_fixed_costs', 'update')[0]?.value).toMatchObject({ status: 'dismissed' })
    expect(find('user_declared_fixed_costs', 'in').some((c) => c.col === 'label')).toBe(true)

    // Accepted candidate + captured gap line → confirmed declared rows.
    const inserted = find('user_declared_fixed_costs', 'insert')[0]?.value as Array<Record<string, unknown>>
    expect(inserted).toHaveLength(2)
    expect(inserted.every((r) => r.status === 'confirmed')).toBe(true)
    expect(inserted.every((r) => r.user_id === 'u1' && r.currency === 'EUR')).toBe(true)
    expect(inserted.find((r) => r.label === 'tmb')).toMatchObject({ source: 'candidate_confirm', amount: 45.5 })
    expect(inserted.find((r) => r.label === 'Electricity')).toMatchObject({
      source: 'gap_capture',
      bill_subtype: 'electricity',
      cadence: 'bi-monthly',
    })

    // Skipped candidate → dismissed recurring_expenses, upserted on (user_id,name).
    const upserted = find('recurring_expenses', 'upsert')[0]
    const upsertRows = upserted?.value as Array<Record<string, unknown>>
    expect(upsertRows[0]).toMatchObject({ name: 'shell', status: 'dismissed', frequency: 'monthly' })
    expect(upserted?.opts).toMatchObject({ onConflict: 'user_id,name' })

    // The total must be recomputed BEFORE the step advances.
    expect(order).toEqual(['sync', 'advance'])
  })

  it('writes nothing extra when every list is empty, but still syncs, advances, and routes', async () => {
    const result = await confirmFixedCosts({
      declaredDismissals: [],
      detectedDismissals: [],
      acceptedCandidates: [],
      skippedCandidates: [],
      declaredLines: [],
    })
    expect(result.redirectTo).toBe('/onboarding-v2/first-read')
    expect(find('user_declared_fixed_costs', 'insert')).toHaveLength(0)
    expect(find('recurring_expenses', 'upsert')).toHaveLength(0)
    expect(find('recurring_expenses', 'update')).toHaveLength(0)
    expect(find('user_declared_fixed_costs', 'update')).toHaveLength(0)
    expect(order).toEqual(['sync', 'advance'])
  })
})
