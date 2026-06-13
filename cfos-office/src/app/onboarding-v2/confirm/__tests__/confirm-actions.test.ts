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
        eq: (col: string, val: unknown) => {
          calls.push({ table, method: 'eq', col, vals: val })
          return b
        },
        neq: () => b,
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
import { advanceStep } from '@/app/onboarding-v2/actions-step'

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
      bankedEdits: [],
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

  it('persists banked-row corrections per source: rent, declared, detected', async () => {
    await confirmFixedCosts({
      declaredDismissals: [],
      detectedDismissals: [],
      bankedEdits: [
        { label: 'Housing', source: 'rent', amount: 1100, cadence: 'monthly', bill_subtype: null },
        { label: 'Gym', source: 'declared', amount: 35, cadence: 'monthly', bill_subtype: null },
        { label: 'claude.ai', source: 'detected', amount: 23, cadence: 'monthly', bill_subtype: null },
      ],
      acceptedCandidates: [],
      skippedCandidates: [],
      declaredLines: [],
    })

    // Rent edit → user_profiles.monthly_rent (monthly equivalent).
    expect(find('user_profiles', 'update')[0]?.value).toMatchObject({ monthly_rent: 1100 })

    // Declared edit → in-place update on user_declared_fixed_costs.
    const declaredUpdates = find('user_declared_fixed_costs', 'update')
    expect(declaredUpdates[0]?.value).toMatchObject({ amount: 35, cadence: 'monthly' })
    expect(
      find('user_declared_fixed_costs', 'eq').some((c) => c.col === 'label' && c.vals === 'Gym'),
    ).toBe(true)

    // Detected edit → recurring row dismissed AND corrected values re-declared
    // as a confirmed banked_edit row (so reconcile can never double-count).
    expect(find('recurring_expenses', 'update')[0]?.value).toMatchObject({ status: 'dismissed' })
    expect(
      find('recurring_expenses', 'in').some(
        (c) => c.col === 'name' && JSON.stringify(c.vals) === JSON.stringify(['claude.ai']),
      ),
    ).toBe(true)
    const inserted = find('user_declared_fixed_costs', 'insert')[0]?.value as Array<Record<string, unknown>>
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      label: 'claude.ai',
      amount: 23,
      cadence: 'monthly',
      status: 'confirmed',
      source: 'banked_edit',
    })

    expect(order).toEqual(['sync', 'advance'])
  })

  it('default mode advances to details_confirmed (the value-first Read trigger)', async () => {
    await confirmFixedCosts({
      declaredDismissals: [],
      detectedDismissals: [],
      bankedEdits: [],
      acceptedCandidates: [],
      skippedCandidates: [],
      declaredLines: [],
    })
    expect(vi.mocked(advanceStep)).toHaveBeenCalledWith('details_confirmed')
    expect(vi.mocked(advanceStep)).not.toHaveBeenCalledWith('check_confirm_done')
  })

  it("check mode advances to check_confirm_done — never details_confirmed — and routes to /office", async () => {
    // The OB-3 gotcha: details_confirmed triggers the legacy value-first Read.
    // The statement-check mission must reconcile (sync the total) WITHOUT it, so
    // the host fires the reality-check Read instead.
    const result = await confirmFixedCosts(
      {
        declaredDismissals: [],
        detectedDismissals: [],
        bankedEdits: [],
        acceptedCandidates: [{ name: 'tmb', amount: 45.5, cadence: 'monthly', bill_subtype: null }],
        skippedCandidates: [],
        declaredLines: [],
      },
      { mode: 'check' },
    )

    expect(result.redirectTo).toBe('/office')
    expect(vi.mocked(advanceStep)).toHaveBeenCalledWith('check_confirm_done')
    expect(vi.mocked(advanceStep)).not.toHaveBeenCalledWith('details_confirmed')
    // The reconcile still runs (it verifies housing/bills against the real
    // month) and the total is synced BEFORE the advance.
    expect(find('user_declared_fixed_costs', 'insert')[0]?.value).toHaveLength(1)
    expect(order).toEqual(['sync', 'advance'])
  })

  it('writes nothing extra when every list is empty, but still syncs, advances, and routes', async () => {
    const result = await confirmFixedCosts({
      declaredDismissals: [],
      detectedDismissals: [],
      bankedEdits: [],
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
