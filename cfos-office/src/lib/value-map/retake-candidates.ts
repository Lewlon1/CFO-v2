import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAndScoreReviewCandidates } from '@/lib/ai/tools/get-value-review-queue'
import type { ValueMapTransaction } from './types'

// ── Types ───────────────────────────────────────────────────────────────

export type CategoryTier = 'core' | 'lifestyle' | 'financial' | 'none'

export type RetakeCandidateStats = {
  merchants_considered: number
  qualifying_merchants: number
  total_low_confidence_txns: number
  tiers_represented: CategoryTier[]
}

export type RetakeCandidatesResult =
  | {
      ok: true
      transactions: (ValueMapTransaction & {
        tier: CategoryTier
        category_id: string | null
        current_value_category: string | null
        current_confidence: number
      })[]
      stats: RetakeCandidateStats
    }
  | {
      ok: false
      reason: 'insufficient_merchants' | 'no_low_confidence_spend'
      stats: RetakeCandidateStats
    }

type CategoryRow = {
  id: string
  name: string
  tier: CategoryTier
}

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_COUNT = 10
const MIN_QUALIFYING_MERCHANTS = 8
const TIER_TARGETS: Record<CategoryTier, number> = {
  core: 4,
  lifestyle: 4,
  financial: 2,
  none: 0,
}

// ── Main selector ───────────────────────────────────────────────────────

/**
 * Select 10 lowest-confidence, highest-impact transactions for a CFO-triggered
 * Value Map retake. Diversifies across category tiers (core/lifestyle/financial).
 *
 * Returns null-ish when the user has fewer than 8 qualifying merchants — not
 * enough signal for a meaningful retake yet.
 */
export async function selectRetakeCandidates(
  supabase: SupabaseClient,
  userId: string,
  opts?: { count?: number; minMerchants?: number }
): Promise<RetakeCandidatesResult> {
  const count = opts?.count ?? DEFAULT_COUNT
  const minMerchants = opts?.minMerchants ?? MIN_QUALIFYING_MERCHANTS

  // 1. Fetch and score uncertain merchant groups
  const { scoredGroups, totalCandidates } = await fetchAndScoreReviewCandidates(
    supabase,
    userId
  )

  const merchantsConsidered = scoredGroups.length

  if (merchantsConsidered < minMerchants) {
    return {
      ok: false,
      reason: merchantsConsidered === 0 ? 'no_low_confidence_spend' : 'insufficient_merchants',
      stats: {
        merchants_considered: merchantsConsidered,
        qualifying_merchants: merchantsConsidered,
        total_low_confidence_txns: totalCandidates,
        tiers_represented: [],
      },
    }
  }

  // 2. Load category tiers in one lookup
  const categoryIds = [
    ...new Set(
      scoredGroups
        .flatMap((g) => g.transactions.map((t) => t.category_id))
        .filter((id): id is string => !!id)
    ),
  ]
  const catMap = new Map<string, CategoryRow>()
  if (categoryIds.length > 0) {
    const { data: cats } = await supabase
      .from('categories')
      .select('id, name, tier')
      .in('id', categoryIds)
    for (const c of (cats ?? []) as CategoryRow[]) {
      catMap.set(c.id, c)
    }
  }

  // 3. Bucket merchants by tier (use the most common category_id per group)
  type ScoredWithMeta = {
    merchant: string
    score: number
    tier: CategoryTier
    category_id: string | null
    category_name: string | null
    pickTxn: (typeof scoredGroups)[number]['transactions'][number]
  }
  const byTier: Record<CategoryTier, ScoredWithMeta[]> = {
    core: [],
    lifestyle: [],
    financial: [],
    none: [],
  }

  for (const group of scoredGroups) {
    const dominantCategoryId = pickDominantCategoryId(group.transactions)
    const cat = dominantCategoryId ? catMap.get(dominantCategoryId) : null
    const tier: CategoryTier = (cat?.tier as CategoryTier) ?? 'none'

    // Within the group, pick the lowest-confidence transaction (tiebreak: most recent)
    const sorted = [...group.transactions].sort((a, b) => {
      const confA = Number(a.value_confidence) || 0
      const confB = Number(b.value_confidence) || 0
      if (confA !== confB) return confA - confB
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })

    byTier[tier].push({
      merchant: group.merchant,
      score: group.score,
      tier,
      category_id: dominantCategoryId,
      category_name: cat?.name ?? null,
      pickTxn: sorted[0],
    })
  }

  // Sort each tier by score descending
  for (const tier of Object.keys(byTier) as CategoryTier[]) {
    byTier[tier].sort((a, b) => b.score - a.score)
  }

  // 4. Tier-diversified selection with redistribution
  const selected: ScoredWithMeta[] = []
  const targets = { ...TIER_TARGETS }

  // First pass: take target count from each tier
  for (const tier of ['core', 'lifestyle', 'financial'] as const) {
    const take = Math.min(targets[tier], byTier[tier].length)
    selected.push(...byTier[tier].slice(0, take))
  }

  // Second pass: redistribute unfilled slots across all tiers by remaining score
  if (selected.length < count) {
    const selectedIds = new Set(selected.map((s) => s.merchant))
    const remaining: ScoredWithMeta[] = []
    for (const tier of ['core', 'lifestyle', 'financial', 'none'] as const) {
      for (const m of byTier[tier]) {
        if (!selectedIds.has(m.merchant)) remaining.push(m)
      }
    }
    remaining.sort((a, b) => b.score - a.score)
    selected.push(...remaining.slice(0, count - selected.length))
  }

  // Trim to exactly `count`
  const final = selected.slice(0, count)

  // 5. Shape as ValueMapTransaction with tier metadata
  const transactions = final.map((m) => {
    const t = m.pickTxn
    const currency = 'EUR' // Will be overridden by API route with user's currency
    return {
      id: t.id,
      merchant: m.merchant,
      description: t.description,
      amount: Math.abs(Number(t.amount)), // positive for UI convention
      currency,
      transaction_date: t.date.slice(0, 10), // YYYY-MM-DD
      is_recurring: false,
      category_name: m.category_name,
      // Extended retake-specific fields
      tier: m.tier,
      category_id: m.category_id,
      current_value_category: t.value_category,
      current_confidence: Number(t.value_confidence) || 0,
    }
  })

  const tiersRepresented = [...new Set(transactions.map((t) => t.tier))] as CategoryTier[]

  return {
    ok: true,
    transactions,
    stats: {
      merchants_considered: merchantsConsidered,
      qualifying_merchants: merchantsConsidered,
      total_low_confidence_txns: totalCandidates,
      tiers_represented: tiersRepresented,
    },
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function pickDominantCategoryId(
  transactions: Array<{ category_id: string | null }>
): string | null {
  const counts = new Map<string, number>()
  for (const t of transactions) {
    if (!t.category_id) continue
    counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  let top = ''
  let max = 0
  for (const [id, c] of counts) {
    if (c > max) {
      max = c
      top = id
    }
  }
  return top
}
