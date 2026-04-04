import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type GapType =
  | 'aligned'
  | 'over_investing'
  | 'leaking_despite_awareness'
  | 'hidden_burden'
  | 'undervalued'

export type GapSeverity = 'low' | 'medium' | 'high'

export interface CategoryGap {
  category: string
  category_slug: string
  // What the user said in their Value Map (via value_category_rules)
  stated_value_category: 'foundation' | 'burden' | 'investment' | 'leak'
  stated_confidence: number
  // Actual spending
  actual_monthly_spend: number
  pct_of_total_spending: number
  actual_value_breakdown: {
    foundation_pct: number
    burden_pct: number
    investment_pct: number
    leak_pct: number
    unsure_pct: number
  }
  // The gap
  gap_type: GapType
  gap_severity: GapSeverity
  narrative: string
}

export interface GapAnalysisSummary {
  total_categories_analysed: number
  aligned_count: number
  gap_count: number
  biggest_gap_category: string
  biggest_gap_type: GapType
  estimated_monthly_leak: number
}

export interface GapAnalysisResult {
  gaps: CategoryGap[]
  summary: GapAnalysisSummary
  has_value_map: boolean
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function analyseGap(
  supabase: SupabaseClient,
  userId: string,
  months = 3
): Promise<GapAnalysisResult> {
  const empty: GapAnalysisResult = {
    gaps: [],
    summary: {
      total_categories_analysed: 0,
      aligned_count: 0,
      gap_count: 0,
      biggest_gap_category: '',
      biggest_gap_type: 'aligned',
      estimated_monthly_leak: 0,
    },
    has_value_map: false,
  }

  // 1. Fetch category-level value_category_rules for this user
  const { data: rules } = await supabase
    .from('value_category_rules')
    .select('match_type, match_value, value_category, confidence')
    .eq('user_id', userId)
    .eq('match_type', 'category_id')

  if (!rules || rules.length === 0) return empty

  // Build map: category_slug → { value_category, confidence }
  const statedMap = new Map<string, { value_category: string; confidence: number }>()
  for (const rule of rules) {
    statedMap.set(rule.match_value, {
      value_category: rule.value_category,
      confidence: rule.confidence ?? 0.5,
    })
  }

  // 2. Fetch actual spending grouped by category (last N months)
  const sinceDate = new Date()
  sinceDate.setMonth(sinceDate.getMonth() - months)
  const since = sinceDate.toISOString().slice(0, 10)

  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount, category_id, value_category')
    .eq('user_id', userId)
    .lt('amount', 0) // expenses only
    .gte('date', since)

  if (!transactions || transactions.length === 0) return { ...empty, has_value_map: true }

  const totalSpend = transactions.reduce((s, t) => s + Math.abs(t.amount), 0)
  if (totalSpend === 0) return { ...empty, has_value_map: true }

  // 3. Group transactions by category_id
  interface CategoryData {
    total: number
    by_value: Record<string, number>
  }
  const byCategory = new Map<string, CategoryData>()
  for (const tx of transactions) {
    const catId = tx.category_id ?? '_unknown'
    const existing = byCategory.get(catId) ?? { total: 0, by_value: {} }
    const abs = Math.abs(tx.amount)
    existing.total += abs
    const vc = tx.value_category ?? 'unsure'
    existing.by_value[vc] = (existing.by_value[vc] ?? 0) + abs
    byCategory.set(catId, existing)
  }

  // 4. Fetch category display names
  const categoryIds = Array.from(statedMap.keys())
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .in('id', categoryIds)

  const categoryNames = new Map<string, string>()
  for (const cat of categories ?? []) {
    categoryNames.set(cat.id, cat.name)
  }

  // 5. Compute gaps
  const gaps: CategoryGap[] = []
  const monthDivisor = Math.max(months, 1)

  for (const [slug, stated] of statedMap.entries()) {
    const catData = byCategory.get(slug)
    if (!catData || catData.total === 0) {
      // User has a rule but no transactions — could be 'undervalued'
      if (stated.value_category === 'investment') {
        const categoryName = categoryNames.get(slug) ?? slug
        gaps.push({
          category: categoryName,
          category_slug: slug,
          stated_value_category: 'investment',
          stated_confidence: stated.confidence,
          actual_monthly_spend: 0,
          pct_of_total_spending: 0,
          actual_value_breakdown: { foundation_pct: 0, burden_pct: 0, investment_pct: 0, leak_pct: 0, unsure_pct: 0 },
          gap_type: 'undervalued',
          gap_severity: 'medium',
          narrative: buildNarrative('undervalued', categoryName, 0, 0, stated.confidence),
        })
      }
      continue
    }

    const pct = (catData.total / totalSpend) * 100
    const monthlySpend = catData.total / monthDivisor
    const vTotal = Object.values(catData.by_value).reduce((s, v) => s + v, 0)
    const vBreakdown = {
      foundation_pct: ((catData.by_value.foundation ?? 0) / vTotal) * 100,
      burden_pct: ((catData.by_value.burden ?? 0) / vTotal) * 100,
      investment_pct: ((catData.by_value.investment ?? 0) / vTotal) * 100,
      leak_pct: ((catData.by_value.leak ?? 0) / vTotal) * 100,
      unsure_pct: ((catData.by_value.unsure ?? 0) / vTotal) * 100,
    }

    const { gap_type, gap_severity } = classifyGap(stated.value_category, pct)
    const categoryName = categoryNames.get(slug) ?? slug

    gaps.push({
      category: categoryName,
      category_slug: slug,
      stated_value_category: stated.value_category as CategoryGap['stated_value_category'],
      stated_confidence: stated.confidence,
      actual_monthly_spend: Math.round(monthlySpend * 100) / 100,
      pct_of_total_spending: Math.round(pct * 10) / 10,
      actual_value_breakdown: {
        foundation_pct: Math.round(vBreakdown.foundation_pct * 10) / 10,
        burden_pct: Math.round(vBreakdown.burden_pct * 10) / 10,
        investment_pct: Math.round(vBreakdown.investment_pct * 10) / 10,
        leak_pct: Math.round(vBreakdown.leak_pct * 10) / 10,
        unsure_pct: Math.round(vBreakdown.unsure_pct * 10) / 10,
      },
      gap_type,
      gap_severity,
      narrative: buildNarrative(gap_type, categoryName, monthlySpend, pct, stated.confidence),
    })
  }

  // 6. Sort by severity (high first)
  const severityOrder: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 }
  gaps.sort((a, b) => severityOrder[a.gap_severity] - severityOrder[b.gap_severity])

  // 7. Save significant gaps to financial_portrait
  const significantGaps = gaps.filter((g) => g.gap_severity !== 'low')
  for (const gap of significantGaps) {
    await supabase.from('financial_portrait').upsert(
      {
        user_id: userId,
        trait_type: 'gap_analysis',
        trait_key: `gap_${gap.category_slug}`,
        trait_value: gap.narrative,
        confidence: gap.gap_severity === 'high' ? 0.9 : 0.7,
        evidence: JSON.stringify({
          gap_type: gap.gap_type,
          stated_value_category: gap.stated_value_category,
          actual_spend_pct: gap.pct_of_total_spending,
          actual_monthly_spend: gap.actual_monthly_spend,
          value_breakdown: gap.actual_value_breakdown,
        }),
        source: 'gap_analysis',
      },
      { onConflict: 'user_id,trait_key' },
    )
  }

  // 8. Build summary
  const alignedCount = gaps.filter((g) => g.gap_type === 'aligned').length
  const gapCount = gaps.filter((g) => g.gap_type !== 'aligned').length
  const estimatedLeak =
    gaps
      .filter((g) => g.stated_value_category === 'leak' || g.gap_type === 'leaking_despite_awareness')
      .reduce((s, g) => s + g.actual_monthly_spend, 0)

  const biggest = gaps.find((g) => g.gap_type !== 'aligned') ?? gaps[0]

  return {
    gaps,
    summary: {
      total_categories_analysed: gaps.length,
      aligned_count: alignedCount,
      gap_count: gapCount,
      biggest_gap_category: biggest?.category ?? '',
      biggest_gap_type: biggest?.gap_type ?? 'aligned',
      estimated_monthly_leak: Math.round(estimatedLeak * 100) / 100,
    },
    has_value_map: true,
  }
}

// ── Gap classification ─────────────────────────────────────────────────────────

function classifyGap(
  stated: string,
  pctOfTotal: number
): { gap_type: GapType; gap_severity: GapSeverity } {
  if (stated === 'leak') {
    if (pctOfTotal > 10) return { gap_type: 'leaking_despite_awareness', gap_severity: 'high' }
    if (pctOfTotal > 5) return { gap_type: 'leaking_despite_awareness', gap_severity: 'medium' }
    return { gap_type: 'aligned', gap_severity: 'low' }
  }

  if (stated === 'investment') {
    if (pctOfTotal > 20) return { gap_type: 'over_investing', gap_severity: 'medium' }
    if (pctOfTotal < 2) return { gap_type: 'undervalued', gap_severity: 'medium' }
    return { gap_type: 'aligned', gap_severity: 'low' }
  }

  if (stated === 'foundation') {
    if (pctOfTotal > 25) return { gap_type: 'hidden_burden', gap_severity: 'medium' }
    if (pctOfTotal > 35) return { gap_type: 'hidden_burden', gap_severity: 'high' }
    return { gap_type: 'aligned', gap_severity: 'low' }
  }

  if (stated === 'burden') {
    if (pctOfTotal > 20) return { gap_type: 'hidden_burden', gap_severity: 'high' }
    return { gap_type: 'aligned', gap_severity: 'low' }
  }

  return { gap_type: 'aligned', gap_severity: 'low' }
}

// ── Narrative builder ─────────────────────────────────────────────────────────

function buildNarrative(
  gapType: GapType,
  category: string,
  monthlySpend: number,
  pct: number,
  confidence: number
): string {
  const spend = monthlySpend > 0 ? `€${Math.round(monthlySpend)}/month` : ''
  const pctStr = pct > 0 ? `${pct.toFixed(1)}% of your total spending` : 'almost nothing'

  switch (gapType) {
    case 'leaking_despite_awareness':
      return confidence >= 4
        ? `You were confident that ${category} is a Leak — yet it's still ${pctStr} (${spend}). The awareness is there. The behaviour hasn't caught up yet.`
        : `You called ${category} a Leak. It's still ${pctStr} (${spend}). That gap between knowing and doing is telling.`

    case 'over_investing':
      return `You see ${category} as an Investment, and you're backing it — ${pctStr} (${spend}). That's a deliberate choice. Worth checking it still feels worth it.`

    case 'hidden_burden':
      return `${category} is a Foundation cost in your mind, but at ${pctStr} (${spend}), it's worth questioning whether you're getting value for that spend or just accepting it.`

    case 'undervalued':
      return `You called ${category} an Investment, but it's barely showing up in your spending. The intention is there — the money isn't following it yet.`

    case 'aligned':
      return `Your ${category} spending aligns with how you see it.`
  }
}
