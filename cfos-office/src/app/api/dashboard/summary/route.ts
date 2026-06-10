import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  isValueDisplayable,
  UNMAPPED_BUCKET,
  ALIGNMENT_DISPLAY_MIN_CONFIDENCE,
} from '@/lib/categorisation/value-config'
import {
  isNeutralCategory,
  INCOME_CATEGORY_ID,
  UNCATEGORISED_CATEGORY_ID,
} from '@/lib/analytics/categories'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { alignmentFromValueBuckets } from '@/lib/value-map/alignment'
import { isValueMapV2Enabled } from '@/lib/value-map/flags'

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

// VM-5 — Alignment Score block. Present only when VALUE_MAP_V2 is on
// (server-side env), so flag-off responses are byte-identical. Always
// anchored to the user's latest snapshot month — it's a trend headline,
// not a month view.
export type AlignmentMonth = {
  month: string
  /** Score for the month, 0–100. Null = no score OR below the honesty
   *  floor for that month — renders as a gap, never a zero. */
  pct: number | null
}

export type AlignmentSummary = {
  /** Null when the latest month is below the honesty floor (or has no
   *  ratio) — render the calibrating state instead of a number. */
  current: { pct: number; confidence: number } | null
  /** The exact €/month still unmapped (a money fact — always allowed).
   *  Populated only when current is null. */
  calibrating: { unmapped_monthly: number } | null
  /** Up to 6 most recent snapshot months, ascending. */
  history: AlignmentMonth[]
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
  alignment?: AlignmentSummary
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const monthParam = req.nextUrl.searchParams.get('month') // YYYY-MM

  // Get all available months
  const { data: snapshots } = await supabase
    .from('monthly_snapshots')
    .select('month, total_income, total_spending, surplus_deficit, transaction_count, avg_transaction_size, largest_transaction, largest_transaction_desc, vs_previous_month_pct, spending_by_category, spending_by_value_category, reviewed_at, review_conversation_id, aligned_spend_pct, alignment_confidence')
    .eq('user_id', user.id)
    .order('month', { ascending: false })

  if (!snapshots || snapshots.length === 0) {
    return NextResponse.json({ hasData: false })
  }

  const availableMonths = snapshots.map(s => s.month)

  // Find the requested month's snapshot. Accept either 'YYYY-MM' (the documented
  // format) or 'YYYY-MM-DD' (what the client historically sent back from
  // available_months, which are raw date strings).
  let snapshot
  if (monthParam) {
    const monthKey = monthParam.slice(0, 7)
    snapshot = snapshots.find(s => String(s.month).startsWith(monthKey))
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

  // Pull both spend rows AND positive non-income rows so refunds can net against
  // their category in the breakdown. Neutral / income categories are excluded server-side.
  const { data: txns } = await supabase
    .from('transactions')
    .select('category_id, value_category, value_confidence, value_confirmed_by_user, amount, description')
    .eq('user_id', user.id)
    .gte('date', monthStart)
    .lt('date', nextMonth)

  // Count per category. Mirrors the bucketing in monthly-snapshot.ts: drop
  // income + neutral rows; bucket NULL-category rows under 'uncategorised' so
  // their counts match the spending_by_category jsonb the writer produces.
  const catCounts: Record<string, number> = {}
  const vcCounts: Record<string, number> = {}
  const vcCatBreakdown: Record<string, Record<string, number>> = {}
  for (const txn of txns ?? []) {
    if (txn.category_id === INCOME_CATEGORY_ID) continue
    if (isNeutralCategory(txn.category_id)) continue
    const cid = (txn.category_id ?? UNCATEGORISED_CATEGORY_ID) as string
    catCounts[cid] = (catCounts[cid] ?? 0) + 1

    // VM-1 honesty gate — must mirror the snapshot writer's bucketing so the
    // enrichment counts line up with the spending_by_value_category jsonb.
    const vc = isValueDisplayable(txn) ? (txn.value_category as string) : UNMAPPED_BUCKET
    vcCounts[vc] = (vcCounts[vc] ?? 0) + 1

    if (!vcCatBreakdown[vc]) vcCatBreakdown[vc] = {}
    // Net amount: outflows positive, refunds negative.
    vcCatBreakdown[vc][cid] = (vcCatBreakdown[vc][cid] ?? 0) + -Number(txn.amount)
  }

  // Enrich spending_by_category with metadata + percentages. Synthetic
  // 'uncategorised' bucket carries display metadata since it has no DB row.
  const rawByCat = (snapshot.spending_by_category ?? {}) as Record<string, number>
  const totalSpending = snapshot.total_spending ?? 0
  const enrichedByCat: Record<string, CategorySummary> = {}
  for (const [slug, amount] of Object.entries(rawByCat)) {
    const cat = catMap.get(slug)
    const isUncategorised = slug === UNCATEGORISED_CATEGORY_ID
    enrichedByCat[slug] = {
      amount: Math.round(amount * 100) / 100,
      count: catCounts[slug] ?? 0,
      pct: totalSpending > 0 ? Math.round((amount / totalSpending) * 1000) / 10 : 0,
      name: cat?.name ?? (isUncategorised ? 'Uncategorised' : slug),
      icon: cat?.icon ?? (isUncategorised ? 'help-circle' : 'circle'),
      color: cat?.color ?? (isUncategorised ? 'var(--value-unsure)' : 'primary'),
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

    // Group by NORMALISED merchant key, not the raw description — this ad-hoc
    // detector used to group (and later upsert into recurring_expenses) by the
    // raw, case-sensitive description. Every bank statement that spelled a
    // merchant differently across import batches ("claude.ai" vs "Claude.ai",
    // "vercel" vs "Vercel") produced a SEPARATE group here, and a separate row
    // in recurring_expenses under the case-sensitive (user_id, name) unique
    // constraint — phantom-inflating fixed costs (Issue 4 of the remediation
    // plan). normaliseMerchant is the SAME normaliser the main recurring
    // detector (recurring-detector.ts) uses, so both writers converge on one
    // row per merchant instead of racing to create case-variant duplicates.
    const descMap = new Map<
      string,
      {
        amounts: number[]
        dates: string[]
        months: Set<string>
        category_id: string | null
        /** Most recent occurrence's raw description — kept for display only. */
        latestDescription: string
        latestDate: string
      }
    >()
    for (const r of recRows ?? []) {
      // Exclude neutral movements (transfers, debt repayments, savings) so things
      // like "Credit card repayment" never surface as recurring spend.
      if (isNeutralCategory(r.category_id) || r.category_id === INCOME_CATEGORY_ID) continue
      const key = normaliseMerchant(r.description)
      if (!key) continue
      let entry = descMap.get(key)
      if (!entry) {
        entry = {
          amounts: [],
          dates: [],
          months: new Set(),
          category_id: r.category_id,
          latestDescription: r.description,
          latestDate: r.date,
        }
        descMap.set(key, entry)
      }
      entry.amounts.push(Math.abs(r.amount))
      entry.dates.push(r.date)
      entry.months.add(r.date.slice(0, 7))
      if (r.date >= entry.latestDate) {
        entry.latestDescription = r.description
        entry.latestDate = r.date
      }
    }

    const EXCLUDED_RECURRING_CATEGORIES = new Set(['groceries', 'eat_drinking_out'])

    const items: Array<RecurringItem & { normalised_name: string }> = []
    for (const [normalisedName, data] of descMap) {
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
        description: data.latestDescription,
        normalised_name: normalisedName,
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      items: items.slice(0, 15).map(({ normalised_name: _normalisedName, ...item }) => item),
      monthly_total: Math.round(items.reduce((s, i) => s + i.monthly_equivalent, 0) * 100) / 100,
    }

    // Persist inferred frequency — best effort, don't block response. Upserts
    // on the NORMALISED name so this writer converges with the main detector
    // instead of racing it into case-variant duplicate rows.
    supabase.from('recurring_expenses').upsert(
      items.map(item => ({
        user_id: user.id,
        name: item.normalised_name,
        amount: item.avg_amount,
        frequency: item.frequency,
        category_id: item.category_id ?? null,
        currency: 'EUR',
      })),
      { onConflict: 'user_id,name', ignoreDuplicates: false }
    ).then(() => {})
  }

  // Self-heal vs_previous_month_pct: the writer can leave this NULL when the
  // previous month's snapshot didn't exist at write time (upload-order race).
  // Snapshots are sorted desc, so the previous calendar month is at index+1.
  let vsPrevPct = snapshot.vs_previous_month_pct
  if (vsPrevPct == null) {
    const idx = snapshots.indexOf(snapshot)
    const prev = idx >= 0 ? snapshots[idx + 1] : undefined
    const currSpend = snapshot.total_spending ?? 0
    if (prev?.total_spending && prev.total_spending > 0) {
      vsPrevPct = Math.round(((currSpend - prev.total_spending) / prev.total_spending) * 1000) / 10
    }
  }

  // VM-5 — alignment block, flag-gated server-side so flag-off responses
  // are byte-identical. The honesty gate applies per month: a score below
  // the display floor is withheld (null), the same rule the chat context
  // builder enforces. Calibrating € derives from the same v1 arithmetic
  // (eligible − displayable) as the stored score.
  let alignment: AlignmentSummary | undefined
  if (isValueMapV2Enabled()) {
    const displayableScore = (s: { aligned_spend_pct: number | null; alignment_confidence: number | null }): number | null =>
      s.aligned_spend_pct != null &&
      Number(s.alignment_confidence ?? 0) >= ALIGNMENT_DISPLAY_MIN_CONFIDENCE
        ? Number(s.aligned_spend_pct)
        : null

    const latest = snapshots[0]
    const history: AlignmentMonth[] = snapshots
      .slice(0, 6)
      .reverse()
      .map((s) => ({ month: s.month, pct: displayableScore(s) }))

    const currentPct = displayableScore(latest)
    let calibrating: AlignmentSummary['calibrating'] = null
    if (currentPct == null) {
      const { components } = alignmentFromValueBuckets(
        (latest.spending_by_value_category ?? {}) as Record<string, number>,
      )
      calibrating = {
        unmapped_monthly: Math.round((components.eligible - components.displayable) * 100) / 100,
      }
    }

    alignment = {
      current:
        currentPct != null
          ? { pct: currentPct, confidence: Number(latest.alignment_confidence) }
          : null,
      calibrating,
      history,
    }
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
    vs_previous_month_pct: vsPrevPct,
    spending_by_category: enrichedByCat,
    spending_by_value_category: enrichedByVc,
    recurring,
    available_months: availableMonths,
    review_status: {
      reviewed: !!snapshot.reviewed_at,
      reviewed_at: snapshot.reviewed_at ?? null,
      conversation_id: snapshot.review_conversation_id ?? null,
    },
    ...(alignment ? { alignment } : {}),
  }

  return NextResponse.json(result)
}
