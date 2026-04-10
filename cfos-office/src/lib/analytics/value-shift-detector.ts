import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValueDistribution {
  count: number
  total: number
  pct: number
}

export interface ValueShift {
  category_id: string
  category_name: string
  previous_dominant: string | null
  current_dominant: string | null
  previous_distribution: Record<string, ValueDistribution>
  current_distribution: Record<string, ValueDistribution>
  amount_difference: number
  notable_transactions: Array<{
    description: string
    amount: number
    date: string
    value_category: string
  }>
  shift_narrative_hint: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RawTxn {
  amount: number
  category_id: string | null
  value_category: string | null
  description: string
  date: string
}

type CategoryBucket = Record<string, { count: number; total: number; txns: RawTxn[] }>

function buildDistributions(
  bucket: CategoryBucket
): { distributions: Record<string, ValueDistribution>; dominant: string | null } {
  const totalSpend = Object.values(bucket).reduce((s, v) => s + v.total, 0)
  if (totalSpend === 0) return { distributions: {}, dominant: null }

  const distributions: Record<string, ValueDistribution> = {}
  let maxPct = 0
  let dominant: string | null = null

  for (const [vc, { count, total }] of Object.entries(bucket)) {
    const pct = Math.round((total / totalSpend) * 100)
    distributions[vc] = { count, total: Math.round(total * 100) / 100, pct }
    if (pct > maxPct) {
      maxPct = pct
      dominant = vc
    }
  }

  return { distributions, dominant }
}

function groupByCategory(txns: RawTxn[]): Record<string, CategoryBucket> {
  const result: Record<string, CategoryBucket> = {}

  for (const txn of txns) {
    const catId = txn.category_id ?? 'uncategorised'
    const vc = txn.value_category ?? 'no_idea'
    const abs = Math.abs(txn.amount)

    if (!result[catId]) result[catId] = {}
    if (!result[catId][vc]) result[catId][vc] = { count: 0, total: 0, txns: [] }
    result[catId][vc].count++
    result[catId][vc].total += abs
    result[catId][vc].txns.push(txn)
  }

  return result
}

function totalTxnCount(bucket: CategoryBucket): number {
  return Object.values(bucket).reduce((s, v) => s + v.count, 0)
}

function totalSpend(bucket: CategoryBucket): number {
  return Object.values(bucket).reduce((s, v) => s + v.total, 0)
}

function generateNarrativeHint(
  categoryName: string,
  prevDominant: string | null,
  currDominant: string | null,
  topTxns: Array<{ description: string }>
): string {
  if (!prevDominant || !currDominant) {
    return `${categoryName} value pattern changed`
  }

  // Try to find a common theme in transaction descriptions
  const descriptions = topTxns.map(t => t.description.toLowerCase())
  const hint = descriptions.length > 0
    ? ` — driven by ${descriptions.slice(0, 2).join(' and ')}`
    : ''

  return `${categoryName} shifted from ${prevDominant} to ${currDominant}${hint}`
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function detectValueShifts(
  supabase: SupabaseClient,
  userId: string,
  reviewMonth: string,   // YYYY-MM
  previousMonth: string  // YYYY-MM
): Promise<ValueShift[]> {
  // Compute date ranges
  const [rYear, rMonth] = reviewMonth.split('-').map(Number)
  const reviewStart = `${reviewMonth}-01`
  const reviewEnd = rMonth === 12
    ? `${rYear + 1}-01-01`
    : `${rYear}-${String(rMonth + 1).padStart(2, '0')}-01`

  const [pYear, pMonth] = previousMonth.split('-').map(Number)
  const prevStart = `${previousMonth}-01`
  const prevEnd = pMonth === 12
    ? `${pYear + 1}-01-01`
    : `${pYear}-${String(pMonth + 1).padStart(2, '0')}-01`

  // Fetch transactions for both months + category names in parallel
  const [currentResult, previousResult, categoriesResult] = await Promise.all([
    supabase
      .from('transactions')
      .select('amount, category_id, value_category, description, date')
      .eq('user_id', userId)
      .gte('date', reviewStart)
      .lt('date', reviewEnd)
      .lt('amount', 0),
    supabase
      .from('transactions')
      .select('amount, category_id, value_category, description, date')
      .eq('user_id', userId)
      .gte('date', prevStart)
      .lt('date', prevEnd)
      .lt('amount', 0),
    supabase
      .from('categories')
      .select('id, name')
      .eq('is_active', true),
  ])

  const currentTxns = (currentResult.data ?? []) as RawTxn[]
  const previousTxns = (previousResult.data ?? []) as RawTxn[]
  const catNameMap = new Map(
    (categoriesResult.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name])
  )

  if (currentTxns.length === 0 || previousTxns.length === 0) return []

  const currentByCategory = groupByCategory(currentTxns)
  const previousByCategory = groupByCategory(previousTxns)

  const shifts: ValueShift[] = []

  // Compare categories present in both months
  const allCategories = new Set([
    ...Object.keys(currentByCategory),
    ...Object.keys(previousByCategory),
  ])

  for (const catId of allCategories) {
    const currBucket = currentByCategory[catId]
    const prevBucket = previousByCategory[catId]

    // Skip if category only exists in one month
    if (!currBucket || !prevBucket) continue

    // Skip categories with fewer than 3 transactions in either month
    if (totalTxnCount(currBucket) < 3 || totalTxnCount(prevBucket) < 3) continue

    const { distributions: currDist, dominant: currDominant } = buildDistributions(currBucket)
    const { distributions: prevDist, dominant: prevDominant } = buildDistributions(prevBucket)

    // Check for shift: dominant changed OR any value moved 10+ percentage points
    const dominantChanged = currDominant !== prevDominant

    let significantMovement = false
    const allVCs = new Set([...Object.keys(currDist), ...Object.keys(prevDist)])
    for (const vc of allVCs) {
      const currPct = currDist[vc]?.pct ?? 0
      const prevPct = prevDist[vc]?.pct ?? 0
      if (Math.abs(currPct - prevPct) >= 10) {
        significantMovement = true
        break
      }
    }

    if (!dominantChanged && !significantMovement) continue

    // Pull top 3 transactions driving the shift (from the current dominant or most-changed VC)
    const targetVC = currDominant ?? Object.keys(currDist)[0]
    const drivingTxns = (currBucket[targetVC]?.txns ?? [])
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 3)
      .map(t => ({
        description: t.description,
        amount: Math.abs(t.amount),
        date: t.date,
        value_category: targetVC,
      }))

    const categoryName = catNameMap.get(catId) ?? catId
    const amountDiff = Math.round((totalSpend(currBucket) - totalSpend(prevBucket)) * 100) / 100

    shifts.push({
      category_id: catId,
      category_name: categoryName,
      previous_dominant: prevDominant,
      current_dominant: currDominant,
      previous_distribution: prevDist,
      current_distribution: currDist,
      amount_difference: amountDiff,
      notable_transactions: drivingTxns,
      shift_narrative_hint: generateNarrativeHint(categoryName, prevDominant, currDominant, drivingTxns),
    })
  }

  // Sort by absolute amount difference (most significant first), cap at 5
  shifts.sort((a, b) => Math.abs(b.amount_difference) - Math.abs(a.amount_difference))
  return shifts.slice(0, 5)
}
