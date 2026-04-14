import { describe, it, expect, vi, beforeEach } from 'vitest'
import { selectRetakeCandidates } from '../retake-candidates'

// ── Mock fetchAndScoreReviewCandidates ────────────────────────────────────

vi.mock('@/lib/ai/tools/get-value-review-queue', () => ({
  fetchAndScoreReviewCandidates: vi.fn(),
}))

import { fetchAndScoreReviewCandidates } from '@/lib/ai/tools/get-value-review-queue'

// ── Test helpers ──────────────────────────────────────────────────────────

type MockTxn = {
  id: string
  description: string
  amount: number
  date: string
  category_id: string | null
  value_category: string | null
  value_confidence: number | null
}

function makeTxn(overrides: Partial<MockTxn> = {}): MockTxn {
  return {
    id: overrides.id ?? `txn-${Math.random()}`,
    description: overrides.description ?? 'ALDI MARKT',
    amount: overrides.amount ?? -12.5,
    date: overrides.date ?? '2026-03-15T12:00:00Z',
    category_id: overrides.category_id ?? null,
    value_category: overrides.value_category ?? null,
    value_confidence: overrides.value_confidence ?? 0.3,
  }
}

function makeGroup(merchant: string, count: number, categoryId: string | null = null, score = 40) {
  return {
    merchant,
    transactions: Array.from({ length: count }, (_, i) =>
      makeTxn({ id: `${merchant}-${i}`, category_id: categoryId })
    ),
    score,
    hasTimeVariance: false,
    hasDayVariance: false,
    hasAmountVariance: false,
  }
}

function makeSupabase(categoriesReturn: Array<{ id: string; name: string; tier: string }>) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'categories') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: categoriesReturn }),
        }
      }
      return {}
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('selectRetakeCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns insufficient_merchants when there are fewer than 8 qualifying merchants', async () => {
    vi.mocked(fetchAndScoreReviewCandidates).mockResolvedValue({
      scoredGroups: Array.from({ length: 5 }, (_, i) => makeGroup(`merch-${i}`, 2)),
      totalCandidates: 10,
    })

    const supabase = makeSupabase([])
    const result = await selectRetakeCandidates(supabase, 'user-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('insufficient_merchants')
      expect(result.stats.qualifying_merchants).toBe(5)
    }
  })

  it('returns no_low_confidence_spend when there are zero qualifying merchants', async () => {
    vi.mocked(fetchAndScoreReviewCandidates).mockResolvedValue({
      scoredGroups: [],
      totalCandidates: 0,
    })

    const supabase = makeSupabase([])
    const result = await selectRetakeCandidates(supabase, 'user-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('no_low_confidence_spend')
    }
  })

  it('returns exactly 10 transactions when 12 qualifying mixed-tier merchants exist', async () => {
    // Build 4 core, 4 lifestyle, 4 financial merchants (12 total)
    const groups = [
      ...['g1', 'g2', 'g3', 'g4'].map((m) => makeGroup(m, 3, 'groceries')),
      ...['l1', 'l2', 'l3', 'l4'].map((m) => makeGroup(m, 3, 'entertainment')),
      ...['f1', 'f2', 'f3', 'f4'].map((m) => makeGroup(m, 3, 'savings')),
    ]
    vi.mocked(fetchAndScoreReviewCandidates).mockResolvedValue({
      scoredGroups: groups,
      totalCandidates: 36,
    })

    const supabase = makeSupabase([
      { id: 'groceries', name: 'Groceries', tier: 'core' },
      { id: 'entertainment', name: 'Entertainment', tier: 'lifestyle' },
      { id: 'savings', name: 'Savings', tier: 'financial' },
    ])

    const result = await selectRetakeCandidates(supabase, 'user-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.transactions).toHaveLength(10)
      const tiers = new Set(result.transactions.map((t) => t.tier))
      expect(tiers.size).toBeGreaterThanOrEqual(2)
      // Tier allocation: 4 core + 4 lifestyle + 2 financial = 10
      const tierCounts = result.transactions.reduce(
        (acc, t) => {
          acc[t.tier] = (acc[t.tier] ?? 0) + 1
          return acc
        },
        {} as Record<string, number>
      )
      expect(tierCounts.core).toBe(4)
      expect(tierCounts.lifestyle).toBe(4)
      expect(tierCounts.financial).toBe(2)
    }
  })

  it('redistributes slots when a tier is empty', async () => {
    // 10 qualifying merchants, all lifestyle (no core, no financial)
    const groups = Array.from({ length: 10 }, (_, i) =>
      makeGroup(`l-${i}`, 3, 'entertainment')
    )
    vi.mocked(fetchAndScoreReviewCandidates).mockResolvedValue({
      scoredGroups: groups,
      totalCandidates: 30,
    })

    const supabase = makeSupabase([
      { id: 'entertainment', name: 'Entertainment', tier: 'lifestyle' },
    ])

    const result = await selectRetakeCandidates(supabase, 'user-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.transactions).toHaveLength(10)
      expect(result.stats.tiers_represented).toEqual(['lifestyle'])
    }
  })

  it('picks lowest-confidence transaction per merchant (tiebreak: most recent)', async () => {
    const hiConf = {
      id: 'aldi-hi',
      description: 'ALDI',
      amount: -10,
      date: '2026-04-01T12:00:00Z',
      category_id: 'groceries',
      value_category: null,
      value_confidence: 0.5,
    }
    const loConf = {
      id: 'aldi-lo',
      description: 'ALDI',
      amount: -10,
      date: '2026-03-01T12:00:00Z',
      category_id: 'groceries',
      value_category: null,
      value_confidence: 0.2,
    }
    const groups = [
      { merchant: 'ALDI', transactions: [hiConf, loConf], score: 50, hasTimeVariance: false, hasDayVariance: false, hasAmountVariance: false },
      ...Array.from({ length: 8 }, (_, i) => makeGroup(`filler-${i}`, 2, 'groceries', 20)),
    ]
    vi.mocked(fetchAndScoreReviewCandidates).mockResolvedValue({
      scoredGroups: groups,
      totalCandidates: 18,
    })

    const supabase = makeSupabase([{ id: 'groceries', name: 'Groceries', tier: 'core' }])

    const result = await selectRetakeCandidates(supabase, 'user-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      const aldi = result.transactions.find((t) => t.merchant === 'ALDI')
      expect(aldi?.id).toBe('aldi-lo') // lowest confidence wins
    }
  })

  it('enriches transactions with category_name and tier', async () => {
    const groups = Array.from({ length: 8 }, (_, i) =>
      makeGroup(`m-${i}`, 3, 'groceries')
    )
    vi.mocked(fetchAndScoreReviewCandidates).mockResolvedValue({
      scoredGroups: groups,
      totalCandidates: 24,
    })

    const supabase = makeSupabase([
      { id: 'groceries', name: 'Groceries', tier: 'core' },
    ])

    const result = await selectRetakeCandidates(supabase, 'user-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.transactions[0].category_name).toBe('Groceries')
      expect(result.transactions[0].tier).toBe('core')
      expect(result.transactions[0].amount).toBeGreaterThan(0) // UI convention: positive
    }
  })

  it('handles merchants with no category (tier: none) as a fallback bucket', async () => {
    // 4 core + 8 uncategorised = 12 qualifying, but only core should fill core slots,
    // uncategorised ones appear only as redistribution fallback
    const groups = [
      ...['g1', 'g2', 'g3', 'g4'].map((m) => makeGroup(m, 2, 'groceries', 50)),
      ...['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map((m) => makeGroup(m, 2, null, 20)),
    ]
    vi.mocked(fetchAndScoreReviewCandidates).mockResolvedValue({
      scoredGroups: groups,
      totalCandidates: 24,
    })

    const supabase = makeSupabase([{ id: 'groceries', name: 'Groceries', tier: 'core' }])

    const result = await selectRetakeCandidates(supabase, 'user-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.transactions).toHaveLength(10)
      // 4 core fills first, then 6 from 'none' via redistribution
      const byTier = result.transactions.reduce(
        (acc, t) => {
          acc[t.tier] = (acc[t.tier] ?? 0) + 1
          return acc
        },
        {} as Record<string, number>
      )
      expect(byTier.core).toBe(4)
      expect(byTier.none).toBe(6)
    }
  })

  it('respects custom minMerchants option', async () => {
    vi.mocked(fetchAndScoreReviewCandidates).mockResolvedValue({
      scoredGroups: Array.from({ length: 3 }, (_, i) => makeGroup(`m-${i}`, 2, 'groceries')),
      totalCandidates: 6,
    })

    const supabase = makeSupabase([{ id: 'groceries', name: 'Groceries', tier: 'core' }])

    // Default minMerchants=8 → fails
    const defaultResult = await selectRetakeCandidates(supabase, 'user-1')
    expect(defaultResult.ok).toBe(false)

    // With minMerchants=3 → passes
    const customResult = await selectRetakeCandidates(supabase, 'user-1', { minMerchants: 3 })
    expect(customResult.ok).toBe(true)
  })
})
