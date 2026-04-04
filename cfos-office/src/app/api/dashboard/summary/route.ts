import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type FrequencyResult = { frequency: string; estimated: boolean; monthly_equivalent: number }

function inferFrequency(months: string[], avgAmount: number): FrequencyResult {
  const sorted = [...months].sort()

  if (sorted.length < 2) {
    return { frequency: 'monthly', estimated: true, monthly_equivalent: avgAmount }
  }

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const [y1, m1] = sorted[i - 1].split('-').map(Number)
    const [y2, m2] = sorted[i].split('-').map(Number)
    gaps.push((y2 - y1) * 12 + (m2 - m1))
  }

  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)]

  // Need ≥4 months to confidently distinguish monthly from bimonthly
  const estimated = sorted.length < 4

  if (median <= 1) return { frequency: 'monthly',        estimated,       monthly_equivalent: avgAmount }
  if (median <= 2) return { frequency: 'bimonthly',      estimated,       monthly_equivalent: avgAmount / 2 }
  if (median <= 4) return { frequency: 'quarterly',      estimated: false, monthly_equivalent: avgAmount / 3 }
  if (median <= 7) return { frequency: 'every 6 months', estimated: false, monthly_equivalent: avgAmount / 6 }
  return                   { frequency: 'annual',         estimated: false, monthly_equivalent: avgAmount / 12 }
}

export type CategorySummary = {
  amount: number
  count: number
  pct: number
  name: string
  icon: string
  color: string
  tier: string
}

export type ValueCategorySummary = {
  amount: number
  pct: number
  count: number
}

export type RecurringItem = {
  description: string
  avg_amount: number
  month_count: number
  last_charged: string
  category_id: string | null
  category_name: string | null
  category_icon: string | null
  previous_amount: number | null
  frequency: string
  estimated_frequency: boolean
  monthly_equivalent: number
}

export type ReviewStatus = {
  reviewed: boolean
  reviewed_at: string | null
  conversation_id: string | null
}

export type DashboardSummary = {
  month: string
  total_income: number
  total_spending: number
  surplus_deficit: number
  transaction_count: number
  avg_transaction_size: number
  largest_transaction: number
  largest_transaction_desc: string | null
  vs_previous_month_pct: number | null
  spending_by_category: Record<string, CategorySummary>
  spending_by_value_category: Record<string, ValueCategorySummary>
  recurring: { items: RecurringItem[]; monthly_total: number }
  available_months: string[]
  review_status: ReviewStatus
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const monthParam = req.nextUrl.searchParams.get('month') // YYYY-MM

  // Get all available months
  const { data: snapshots } = await supabase
    .from('monthly_snapshots')
    .select('month, total_income, total_spending, surplus_deficit, transaction_count, avg_transaction_size, largest_transaction, largest_transaction_desc, vs_previous_month_pct, spending_by_category, spending_by_value_category, reviewed_at, review_conversation_id')
    .eq('user_id', user.id)
    .order('month', { ascending: false })

  if (!snapshots || snapshots.length === 0) {
    return NextResponse.json({ error: 'no_data' }, { status: 404 })
  }

  const availableMonths = snapshots.map(s => s.month)

  // Find the requested month's snapshot
  let snapshot
  if (monthParam) {
    const monthDate = `${monthParam}-01`
    snapshot = snapshots.find(s => s.month === monthDate)
    if (!snapshot) {
      return NextResponse.json({ error: 'Month not found' }, { status: 404 })
    }
  } else {
    snapshot = snapshots[0]
  }

  // Get categories for metadata enrichment
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, icon, color, tier')
    .eq('is_active', true)

  const catMap = new Map((categories ?? []).map(c => [c.id, c]))

  // Get transaction counts per category for this month
  const monthStart = snapshot.month
  const [yearNum, monthNum] = monthStart.split('-').map(Number)
  const nextMonth = monthNum === 12
    ? `${yearNum + 1}-01-01`
    : `${yearNum}-${String(monthNum + 1).padStart(2, '0')}-01`

  const { data: txns } = await supabase
    .from('transactions')
    .select('category_id, value_category, amount, description')
    .eq('user_id', user.id)
    .gte('date', monthStart)
    .lt('date', nextMonth)
    .lt('amount', 0)

  // Count per category
  const catCounts: Record<string, number> = {}
  const vcCounts: Record<string, number> = {}
  // Top categories per value category
  const vcCatBreakdown: Record<string, Record<string, number>> = {}
  for (const txn of txns ?? []) {
    const cid = txn.category_id ?? 'uncategorised'
    catCounts[cid] = (catCounts[cid] ?? 0) + 1

    const vc = txn.value_category ?? 'unsure'
    vcCounts[vc] = (vcCounts[vc] ?? 0) + 1

    if (!vcCatBreakdown[vc]) vcCatBreakdown[vc] = {}
    vcCatBreakdown[vc][cid] = (vcCatBreakdown[vc][cid] ?? 0) + Math.abs(txn.amount)
  }

  // Enrich spending_by_category with metadata + percentages
  const rawByCat = (snapshot.spending_by_category ?? {}) as Record<string, number>
  const totalSpending = snapshot.total_spending ?? 0
  const enrichedByCat: Record<string, CategorySummary> = {}
  for (const [slug, amount] of Object.entries(rawByCat)) {
    const cat = catMap.get(slug)
    enrichedByCat[slug] = {
      amount: Math.round(amount * 100) / 100,
      count: catCounts[slug] ?? 0,
      pct: totalSpending > 0 ? Math.round((amount / totalSpending) * 1000) / 10 : 0,
      name: cat?.name ?? slug,
      icon: cat?.icon ?? 'circle',
      color: cat?.color ?? 'primary',
      tier: cat?.tier ?? 'core',
    }
  }

  // Enrich spending_by_value_category
  const rawByVc = (snapshot.spending_by_value_category ?? {}) as Record<string, number>
  const enrichedByVc: Record<string, ValueCategorySummary & { top_categories?: { slug: string; name: string; amount: number }[] }> = {}
  for (const [vc, amount] of Object.entries(rawByVc)) {
    const topCats = Object.entries(vcCatBreakdown[vc] ?? {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([slug, amt]) => ({
        slug,
        name: catMap.get(slug)?.name ?? slug,
        amount: Math.round(amt * 100) / 100,
      }))

    enrichedByVc[vc] = {
      amount: Math.round(amount * 100) / 100,
      pct: totalSpending > 0 ? Math.round((amount / totalSpending) * 1000) / 10 : 0,
      count: vcCounts[vc] ?? 0,
      top_categories: topCats,
    }
  }

  // Recurring charges: detect from transactions directly
  let recurring: { items: RecurringItem[]; monthly_total: number }
  {
    const { data: recRows } = await supabase
      .from('transactions')
      .select('description, amount, date, category_id')
      .eq('user_id', user.id)
      .lt('amount', 0)

    const descMap = new Map<string, { amounts: number[]; dates: string[]; months: Set<string>; category_id: string | null }>()
    for (const r of recRows ?? []) {
      const key = r.description
      if (!descMap.has(key)) descMap.set(key, { amounts: [], dates: [], months: new Set(), category_id: r.category_id })
      const entry = descMap.get(key)!
      entry.amounts.push(Math.abs(r.amount))
      entry.dates.push(r.date)
      entry.months.add(r.date.slice(0, 7))
    }

    const EXCLUDED_RECURRING_CATEGORIES = new Set(['groceries', 'eat_drinking_out'])

    const items: RecurringItem[] = []
    for (const [desc, data] of descMap) {
      if (data.months.size < 2) continue
      if (data.category_id && EXCLUDED_RECURRING_CATEGORIES.has(data.category_id)) continue
      const avg = data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length
      const avgRounded = Math.round(avg * 100) / 100
      const sorted = data.dates.sort()
      const cat = catMap.get(data.category_id ?? '')

      // Detect amount change: compare latest 2 amounts
      const sortedAmounts = data.amounts.slice().sort((a, b) => {
        const idxA = data.dates.indexOf(data.dates.find((_, i) => data.amounts[i] === a) ?? '')
        const idxB = data.dates.indexOf(data.dates.find((_, i) => data.amounts[i] === b) ?? '')
        return idxA - idxB
      })
      const prevAmt = sortedAmounts.length >= 2 ? sortedAmounts[sortedAmounts.length - 2] : null

      const { frequency, estimated: estimated_frequency, monthly_equivalent } = inferFrequency(
        Array.from(data.months),
        avgRounded
      )

      items.push({
        description: desc,
        avg_amount: avgRounded,
        month_count: data.months.size,
        last_charged: sorted[sorted.length - 1],
        category_id: data.category_id,
        category_name: cat?.name ?? null,
        category_icon: cat?.icon ?? null,
        previous_amount: prevAmt !== null ? Math.round(prevAmt * 100) / 100 : null,
        frequency,
        estimated_frequency,
        monthly_equivalent: Math.round(monthly_equivalent * 100) / 100,
      })
    }

    items.sort((a, b) => b.avg_amount - a.avg_amount)
    recurring = {
      items: items.slice(0, 15),
      monthly_total: Math.round(items.reduce((s, i) => s + i.monthly_equivalent, 0) * 100) / 100,
    }

    // Persist inferred frequency — best effort, don't block response
    supabase.from('recurring_expenses').upsert(
      items.map(item => ({
        user_id: user.id,
        name: item.description,
        amount: item.avg_amount,
        frequency: item.frequency,
        category_id: item.category_id ?? null,
        currency: 'EUR',
      })),
      { onConflict: 'user_id,name', ignoreDuplicates: false }
    ).then(() => {})
  }

  const result: DashboardSummary = {
    month: snapshot.month,
    total_income: snapshot.total_income ?? 0,
    total_spending: snapshot.total_spending ?? 0,
    surplus_deficit: snapshot.surplus_deficit ?? 0,
    transaction_count: snapshot.transaction_count ?? 0,
    avg_transaction_size: snapshot.avg_transaction_size ?? 0,
    largest_transaction: snapshot.largest_transaction ?? 0,
    largest_transaction_desc: snapshot.largest_transaction_desc,
    vs_previous_month_pct: snapshot.vs_previous_month_pct,
    spending_by_category: enrichedByCat,
    spending_by_value_category: enrichedByVc,
    recurring,
    available_months: availableMonths,
    review_status: {
      reviewed: !!snapshot.reviewed_at,
      reviewed_at: snapshot.reviewed_at ?? null,
      conversation_id: snapshot.review_conversation_id ?? null,
    },
  }

  return NextResponse.json(result)
}
