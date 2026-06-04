import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchAndScoreReviewCandidates,
  fetchClassifiedMerchants,
} from './get-value-review-queue'

type Row = Record<string, unknown>

/**
 * Minimal chainable Supabase mock covering the three queries that
 * fetchAndScoreReviewCandidates + fetchClassifiedMerchants make:
 *   1. transactions candidates → eq(value_confirmed_by_user,false), terminal .limit()
 *   2. transactions confirmed  → eq(value_confirmed_by_user,true),  terminal .limit()
 *   3. value_category_rules    → terminal .in('match_type', …)
 * The real normaliseMerchant runs unmocked so the dedup keys line up exactly.
 */
function makeSupabase(opts: { candidates: Row[]; confirmed: Row[]; rules: Row[] }): SupabaseClient {
  return {
    from: (table: string) => {
      const state: { confirmedFlag?: boolean } = {}
      const builder: Record<string, (...a: unknown[]) => unknown> = {
        select: () => builder,
        eq: (col: unknown, val: unknown) => {
          if (col === 'value_confirmed_by_user') state.confirmedFlag = val as boolean
          return builder
        },
        or: () => builder,
        lt: () => builder,
        order: () => builder,
        in: () => Promise.resolve({ data: opts.rules, error: null }),
        limit: () =>
          Promise.resolve({
            data:
              table === 'transactions' && state.confirmedFlag === true
                ? opts.confirmed
                : opts.candidates,
            error: null,
          }),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

function candidate(id: string, description: string, value_confidence: number | null = 0.3): Row {
  return {
    id,
    description,
    amount: -10,
    date: '2026-03-15T12:00:00Z',
    category_id: null,
    value_category: null,
    value_confidence,
  }
}

describe('fetchClassifiedMerchants', () => {
  it('folds confirmed-transaction descriptions and rule match_values into one normalised set', async () => {
    const supabase = makeSupabase({
      candidates: [],
      confirmed: [{ description: 'ALDI' }, { description: 'PUREGYM LTD MANCHESTER GBR' }],
      rules: [{ match_value: 'spotify' }],
    })
    const set = await fetchClassifiedMerchants(supabase, 'u1')
    expect(set.has('aldi')).toBe(true)
    expect(set.has('spotify')).toBe(true)
    expect([...set].some((k) => k.includes('puregym'))).toBe(true)
  })

  it('returns an empty set when the user has classified nothing', async () => {
    const supabase = makeSupabase({ candidates: [], confirmed: [], rules: [] })
    const set = await fetchClassifiedMerchants(supabase, 'u1')
    expect(set.size).toBe(0)
  })
})

describe('fetchAndScoreReviewCandidates — dedup guard (SESSION-LOG D1)', () => {
  it('drops a merchant the user already classified (confirmed transaction), keeps the rest', async () => {
    const supabase = makeSupabase({
      candidates: [
        // Aldi siblings still low-confidence after the user confirmed ONE Aldi card
        candidate('aldi-1', 'ALDI'),
        candidate('aldi-2', 'ALDI'),
        // a genuinely-uncertain merchant the user has not touched
        candidate('pret-1', 'PRET'),
        candidate('pret-2', 'PRET'),
      ],
      confirmed: [{ description: 'ALDI' }],
      rules: [],
    })
    const { scoredGroups, totalCandidates } = await fetchAndScoreReviewCandidates(supabase, 'u1')
    const merchants = scoredGroups.map((g) => g.merchant)
    expect(merchants).toContain('pret')
    expect(merchants).not.toContain('aldi')
    // totalCandidates counts only what survives the dedup guard
    expect(totalCandidates).toBe(2)
  })

  it('drops a merchant excluded via a learned merchant rule', async () => {
    const supabase = makeSupabase({
      candidates: [candidate('s1', 'SPOTIFY'), candidate('p1', 'PRET')],
      confirmed: [],
      rules: [{ match_value: 'spotify' }],
    })
    const { scoredGroups } = await fetchAndScoreReviewCandidates(supabase, 'u1')
    const merchants = scoredGroups.map((g) => g.merchant)
    expect(merchants).not.toContain('spotify')
    expect(merchants).toContain('pret')
  })

  it('does not starve the queue — uncertain merchants with no classification still surface', async () => {
    const supabase = makeSupabase({
      candidates: [
        candidate('u-1', 'UBER'),
        candidate('n-1', 'NETFLIX'),
        candidate('w-1', 'WAGAMAMA'),
      ],
      confirmed: [{ description: 'ALDI' }], // unrelated to the candidate merchants
      rules: [],
    })
    const { scoredGroups } = await fetchAndScoreReviewCandidates(supabase, 'u1')
    expect(scoredGroups.map((g) => g.merchant).sort()).toEqual(['netflix', 'uber', 'wagamama'])
  })
})
