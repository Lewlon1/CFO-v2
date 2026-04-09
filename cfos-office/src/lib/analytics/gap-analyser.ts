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

  // 0. Detect Value Map completion independently of rule format.
  //    The VM seeds merchant_contains rules (see /api/value-map/link-session), so
  //    a missing category_id rule set does NOT mean "no VM". Always consult
  //    value_map_results directly before deciding has_value_map.
  const { data: vmRows } = await supabase
    .from('value_map_results')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
  const hasValueMap = (vmRows?.length ?? 0) > 0

  // 1. Fetch ALL value category rules for this user (both category_id and merchant_contains).
  const { data: rules } = await supabase
    .from('value_category_rules')
    .select('match_type, match_value, value_category, confidence')
    .eq('user_id', userId)
    .in('match_type', ['category_id', 'merchant_contains'])

  if (!rules || rules.length === 0) {
    return { ...empty, has_value_map: hasValueMap }
  }

  // Split rules by type. Category-level rules come from chat corrections;
  // merchant-level rules come from the Value Map (see /api/value-map/link-session).
  const categoryRules = rules.filter((r) => r.match_type === 'category_id')
  const merchantRules = rules.filter((r) => r.match_type === 'merchant_contains')

  // 2. Fetch all expense transactions for the window.
  const sinceDate = new Date()
  sinceDate.setMonth(sinceDate.getMonth() - months)
  const since = sinceDate.toISOString().slice(0, 10)

  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount, description, category_id, value_category')
    .eq('user_id', userId)
    .lt('amount', 0) // expenses only
    .gte('date', since)

  if (!transactions || transactions.length === 0) {
    return { ...empty, has_value_map: hasValueMap }
  }

  const totalSpend = transactions.reduce((s, t) => s + Math.abs(t.amount), 0)
  if (totalSpend === 0) return { ...empty, has_value_map: hasValueMap }

  // 3. Group transactions by category_id (for category rules).
  interface GroupData {
    total: number
    by_value: Record<string, number>
  }
  const byCategory = new Map<string, GroupData>()
  for (const tx of transactions) {
    const catId = tx.category_id ?? '_unknown'
    const existing = byCategory.get(catId) ?? { total: 0, by_value: {} }
    const abs = Math.abs(tx.amount)
    existing.total += abs
    const vc = tx.value_category ?? 'unsure'
    existing.by_value[vc] = (existing.by_value[vc] ?? 0) + abs
    byCategory.set(catId, existing)
  }

  // 4. Fetch category display names (only for category rules).
  const categoryIds = categoryRules.map((r) => r.match_value)
  const categoryNames = new Map<string, string>()
  if (categoryIds.length > 0) {
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name')
      .in('id', categoryIds)
    for (const cat of categories ?? []) {
      categoryNames.set(cat.id, cat.name)
    }
  }

  const gaps: CategoryGap[] = []
  const monthDivisor = Math.max(months, 1)

  const pushGap = (
    label: string,
    slug: string,
    stated: { value_category: string; confidence: number },
    groupData: GroupData | undefined,
  ) => {
    if (!groupData || groupData.total === 0) {
      // Stated investment with no spending = undervalued.
      if (stated.value_category === 'investment') {
        gaps.push({
          category: label,
          category_slug: slug,
          stated_value_category: 'investment',
          stated_confidence: stated.confidence,
          actual_monthly_spend: 0,
          pct_of_total_spending: 0,
          actual_value_breakdown: {
            foundation_pct: 0,
            burden_pct: 0,
            investment_pct: 0,
            leak_pct: 0,
            unsure_pct: 0,
          },
          gap_type: 'undervalued',
          gap_severity: 'medium',
          narrative: buildNarrative('undervalued', label, 0, 0, stated.confidence),
        })
      }
      return
    }

    const pct = (groupData.total / totalSpend) * 100
    const monthlySpend = groupData.total / monthDivisor
    const vTotal = Object.values(groupData.by_value).reduce((s, v) => s + v, 0) || 1
    const vBreakdown = {
      foundation_pct: ((groupData.by_value.foundation ?? 0) / vTotal) * 100,
      burden_pct: ((groupData.by_value.burden ?? 0) / vTotal) * 100,
      investment_pct: ((groupData.by_value.investment ?? 0) / vTotal) * 100,
      leak_pct: ((groupData.by_value.leak ?? 0) / vTotal) * 100,
      unsure_pct: ((groupData.by_value.unsure ?? 0) / vTotal) * 100,
    }

    const { gap_type, gap_severity } = classifyGap(stated.value_category, pct)

    gaps.push({
      category: label,
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
      narrative: buildNarrative(gap_type, label, monthlySpend, pct, stated.confidence),
    })
  }

  // 5a. Category-level gaps (chat corrections / category_id rules).
  for (const rule of categoryRules) {
    const label = categoryNames.get(rule.match_value) ?? rule.match_value
    pushGap(label, rule.match_value, {
      value_category: rule.value_category,
      confidence: rule.confidence ?? 0.5,
    }, byCategory.get(rule.match_value))
  }

  // 5b. Merchant-level gaps (Value Map rules). For each merchant rule, sum
  //     matching transactions by description substring (same matcher the
  //     value-categoriser uses).
  for (const rule of merchantRules) {
    const needle = rule.match_value.toLowerCase()
    if (!needle) continue

    const group: GroupData = { total: 0, by_value: {} }
    for (const tx of transactions) {
      if (!tx.description) continue
      if (!tx.description.toLowerCase().includes(needle)) continue
      const abs = Math.abs(tx.amount)
      group.total += abs
      const vc = tx.value_category ?? 'unsure'
      group.by_value[vc] = (group.by_value[vc] ?? 0) + abs
    }

    // Title-case the merchant name for display.
    const label = rule.match_value
      .split(' ')
      .map((w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ')

    pushGap(label, `merchant:${needle}`, {
      value_category: rule.value_category,
      confidence: rule.confidence ?? 0.5,
    }, group.total > 0 ? group : undefined)
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
    has_value_map: hasValueMap,
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
      return confidence >= 0.8
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
