import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assessCategoryCoverage } from '../category-coverage'

type TxnRow = { description: string; category_id: string | null; date: string; amount: number }

function buildStub(args: { txns?: TxnRow[]; monthlyRent?: number | null }): SupabaseClient {
  const tableData: Record<string, { data: unknown }> = {
    transactions: { data: args.txns ?? [] },
    user_profiles: { data: { monthly_rent: args.monthlyRent ?? null } },
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

async function coverageByKey(supabase: SupabaseClient) {
  const lines = await assessCategoryCoverage(supabase, 'u1')
  return Object.fromEntries(lines.map((l) => [l.key, l.covered])) as Record<string, boolean>
}

describe('assessCategoryCoverage', () => {
  it('marks every fixed-cost line uncovered when nothing maps and no rent is set', async () => {
    const lines = await assessCategoryCoverage(buildStub({ txns: [], monthlyRent: null }), 'u1')
    // The motivating case: a statement with zero utility-shaped transactions.
    expect(lines.length).toBeGreaterThanOrEqual(6)
    for (const line of lines) {
      expect(line.covered).toBe(false)
    }
    // Shape contract for the UI.
    const electricity = lines.find((l) => l.key === 'electricity')!
    expect(electricity).toMatchObject({
      key: 'electricity',
      group: 'utilities',
    })
    expect(typeof electricity.label).toBe('string')
    expect(typeof electricity.placeholder).toBe('string')
    expect(electricity.defaultCadence).toBeTruthy()
  })

  it('covers broadband when a benchmarkable broadband txn is present (subtype path)', async () => {
    const byKey = await coverageByKey(
      buildStub({
        txns: [{ description: 'Vodafone Fibra', category_id: 'utilities_bills', date: '2026-02-01', amount: -40 }],
      }),
    )
    expect(byKey.broadband).toBe(true)
    // Other utilities stay uncovered — one bill does not cover the group.
    expect(byKey.electricity).toBe(false)
    expect(byKey.gas).toBe(false)
    expect(byKey.water).toBe(false)
  })

  it('covers broadband via keyword for a provider the subtype classifier misses (Digi)', async () => {
    const byKey = await coverageByKey(
      buildStub({
        txns: [{ description: 'Digi', category_id: 'utilities_bills', date: '2026-02-01', amount: -30 }],
      }),
    )
    expect(byKey.broadband).toBe(true)
  })

  it('does not false-positive broadband on a substring match (Digital Ocean)', async () => {
    const byKey = await coverageByKey(
      buildStub({
        txns: [{ description: 'Digital Ocean', category_id: 'subscriptions', date: '2026-02-01', amount: -20 }],
      }),
    )
    expect(byKey.broadband).toBe(false)
  })

  it('covers electricity via the subtype classifier (Endesa) without covering gas', async () => {
    const byKey = await coverageByKey(
      buildStub({
        txns: [{ description: 'Endesa', category_id: 'utilities_bills', date: '2026-02-01', amount: -90 }],
      }),
    )
    expect(byKey.electricity).toBe(true)
    expect(byKey.gas).toBe(false)
  })

  it('covers housing when monthly_rent is set, even with no housing transaction', async () => {
    const byKey = await coverageByKey(buildStub({ txns: [], monthlyRent: 1100 }))
    expect(byKey.housing).toBe(true)
  })
})
