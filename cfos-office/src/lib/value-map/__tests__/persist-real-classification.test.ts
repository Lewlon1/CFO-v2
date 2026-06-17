import { describe, it, expect, vi, beforeEach } from 'vitest'

// Keep the snapshot refresh inert — it is awaited inside the persistence path.
vi.mock('@/lib/analytics/monthly-snapshot', () => ({
  refreshMonthlySnapshots: vi.fn(async () => {}),
  extractAffectedMonths: vi.fn(() => ['2026-03']),
}))

// runMerchantLearning fans out to these — mocked so we can assert the loop.
vi.mock('@/lib/prediction/process-signals', () => ({
  processSignals: vi.fn(async () => {}),
}))
vi.mock('@/lib/prediction/backfill', () => ({
  backfillForMerchant: vi.fn(async () => {}),
}))

import {
  persistRealValueClassifications,
  runMerchantLearning,
} from '../persist-real-classification'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { NONE_TIME_CONTEXT } from '@/lib/prediction/types'
import { processSignals } from '@/lib/prediction/process-signals'
import { backfillForMerchant } from '@/lib/prediction/backfill'

// ── Mock supabase ──────────────────────────────────────────────────────────

type Txn = {
  id: string
  description: string
  date: string
  amount: number
  category_id: string | null
}

function makeSupabase(txns: Txn[]) {
  const captured = {
    signalInserts: [] as Record<string, unknown>[][],
    ruleUpserts: [] as Record<string, unknown>[][],
    confirmUpdates: [] as Array<{
      payload: Record<string, unknown>
      eqs: Array<[string, unknown]>
    }>,
  }

  function transactionsTable() {
    return {
      // SELECT path: .select().eq().in()
      select: () => ({
        eq: () => ({
          in: async () => ({ data: txns, error: null }),
        }),
      }),
      // UPDATE (confirm) path: .update(payload).eq('id').eq('user_id')
      update: (payload: Record<string, unknown>) => {
        const record = { payload, eqs: [] as Array<[string, unknown]> }
        const chain = {
          eq: (k: string, v: unknown) => {
            record.eqs.push([k, v])
            return chain
          },
          then: (resolve: (r: { error: null }) => unknown) => {
            captured.confirmUpdates.push(record)
            return resolve({ error: null })
          },
        }
        return chain
      },
    }
  }

  const client = {
    from: (table: string) => {
      if (table === 'transactions') return transactionsTable()
      if (table === 'correction_signals') {
        return {
          insert: async (rows: Record<string, unknown>[]) => {
            captured.signalInserts.push(rows)
            return { error: null }
          },
        }
      }
      if (table === 'value_category_rules') {
        return {
          upsert: async (rows: Record<string, unknown>[]) => {
            captured.ruleUpserts.push(rows)
            return { error: null }
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: client as any, captured }
}

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('persistRealValueClassifications', () => {
  it('inserts a weighted signal, a synchronous merchant rule, and confirms each txn', async () => {
    const { supabase, captured } = makeSupabase([
      { id: 't1', description: 'TESCO STORES 2914', date: '2026-03-04T18:00:00Z', amount: -42, category_id: 'groceries' },
    ])

    const result = await persistRealValueClassifications(
      supabase,
      USER,
      [{ transaction_id: 't1', quadrant: 'foundation', confidence: 4 }],
      { weightMultiplier: 2.0 },
    )

    expect(result.classified).toBe(1)
    const merchant = normaliseMerchant('TESCO STORES 2914')
    expect(result.merchantsAffected).toEqual([merchant])

    // Correction signal @ the requested weight, keyed on the normalised merchant.
    expect(captured.signalInserts).toHaveLength(1)
    const sig = captured.signalInserts[0][0]
    expect(sig).toMatchObject({
      user_id: USER,
      transaction_id: 't1',
      merchant_clean: merchant,
      value_category: 'foundation',
      weight_multiplier: 2.0,
      category_id: 'groceries',
    })

    // Synchronous merchant rule — the Layer-2 by_merchant source the recompose reads.
    expect(captured.ruleUpserts).toHaveLength(1)
    const rule = captured.ruleUpserts[0][0]
    expect(rule).toMatchObject({
      user_id: USER,
      match_type: 'merchant',
      match_value: merchant,
      value_category: 'foundation',
      confidence: 4 / 5,
      time_context: NONE_TIME_CONTEXT,
      source: 'value_map_personal',
    })

    // Hard confirm on the carded transaction.
    expect(captured.confirmUpdates).toHaveLength(1)
    expect(captured.confirmUpdates[0].payload).toMatchObject({
      value_category: 'foundation',
      value_confidence: 1.0,
      value_confirmed_by_user: true,
      prediction_source: 'user_confirmed',
    })
    expect(captured.confirmUpdates[0].eqs).toContainEqual(['id', 't1'])
    expect(captured.confirmUpdates[0].eqs).toContainEqual(['user_id', USER])
  })

  it('emits one rule per merchant but a signal per card (same-merchant batch)', async () => {
    const { supabase, captured } = makeSupabase([
      { id: 't1', description: 'DELIVEROO', date: '2026-03-01T20:00:00Z', amount: -18, category_id: 'eat_out' },
      { id: 't2', description: 'DELIVEROO', date: '2026-03-09T21:00:00Z', amount: -24, category_id: 'eat_out' },
    ])

    const result = await persistRealValueClassifications(
      supabase,
      USER,
      [
        { transaction_id: 't1', quadrant: 'leak', confidence: 5 },
        { transaction_id: 't2', quadrant: 'leak', confidence: 5 },
      ],
      { weightMultiplier: 1.0 },
    )

    expect(result.classified).toBe(2)
    // Two signals (one per card), but a single deduped merchant.
    expect(captured.signalInserts[0]).toHaveLength(2)
    expect(result.merchantsAffected).toEqual([normaliseMerchant('DELIVEROO')])
    // One rule row for the merchant (dedup avoids the ON CONFLICT double-touch).
    expect(captured.ruleUpserts[0]).toHaveLength(1)
    // Both transactions confirmed.
    expect(captured.confirmUpdates).toHaveLength(2)
  })

  it('skips invalid quadrants and returns nothing to do when empty', async () => {
    const { supabase, captured } = makeSupabase([])
    const result = await persistRealValueClassifications(
      supabase,
      USER,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [{ transaction_id: 't1', quadrant: 'unsure' as any }],
      { weightMultiplier: 1.0 },
    )
    expect(result).toEqual({ classified: 0, merchantsAffected: [], affectedDates: [] })
    expect(captured.signalInserts).toHaveLength(0)
    expect(captured.ruleUpserts).toHaveLength(0)
  })

  it('defaults confidence to 3/5 when omitted', async () => {
    const { supabase, captured } = makeSupabase([
      { id: 't1', description: 'OCTOPUS ENERGY', date: '2026-03-04T09:00:00Z', amount: -120, category_id: 'utilities' },
    ])
    await persistRealValueClassifications(
      supabase,
      USER,
      [{ transaction_id: 't1', quadrant: 'burden' }],
      { weightMultiplier: 1.0 },
    )
    expect(captured.ruleUpserts[0][0]).toMatchObject({ confidence: 3 / 5 })
  })
})

describe('runMerchantLearning', () => {
  it('runs processSignals then backfill for each merchant', async () => {
    await runMerchantLearning(USER, ['tesco', 'deliveroo'])
    expect(processSignals).toHaveBeenCalledTimes(2)
    expect(backfillForMerchant).toHaveBeenCalledTimes(2)
    expect(processSignals).toHaveBeenCalledWith(USER, 'tesco')
    expect(backfillForMerchant).toHaveBeenCalledWith(USER, 'deliveroo')
  })

  it('swallows a per-merchant failure and continues', async () => {
    vi.mocked(processSignals).mockRejectedValueOnce(new Error('boom'))
    await expect(runMerchantLearning(USER, ['a', 'b'])).resolves.toBeUndefined()
    // 'b' still processed despite 'a' throwing.
    expect(processSignals).toHaveBeenCalledTimes(2)
  })
})
