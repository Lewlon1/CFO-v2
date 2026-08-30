import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshMemoryDigests } from '@/lib/memory/digests'

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
  //    The VM seeds merchant rules (see /api/value-map/link-session), so
  //    a missing category_id rule set does NOT mean "no VM". Always consult
  //    value_map_results directly before deciding has_value_map.
  //    Note: value_map_results is keyed by profile_id (same UUID as user_id in auth.users).
  const { data: vmRows } = await supabase
    .from('value_map_results')
    .select('id')
    .eq('profile_id', userId)
    .limit(1)
  const hasValueMap = (vmRows?.length ?? 0) > 0

  // 1. Fetch ALL value category rules for this user (both category and merchant).
  const { data: rules } = await supabase
    .from('value_category_rules')
    .select('match_type, match_value, value_category, confidence')
    .eq('user_id', userId)
    .in('match_type', ['category', 'merchant'])

  if (!rules || rules.length === 0) {
    return { ...empty, has_value_map: hasValueMap }
  }

  // Split rules by type. Category-level rules come from chat corrections;
  // merchant-level rules come from the Value Map (see /api/value-map/link-session).
  const categoryRules = rules.filter((r) => r.match_type === 'category')
  const merchantRules = rules.filter((r) => r.match_type === 'merchant')

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

  // The gap traits just written are what the CFO reads about intent-vs-spend,
  // and it reads them from the Values digest now rather than from the prompt.
  if (significantGaps.length > 0) await refreshMemoryDigests(supabase, userId)

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

// ── Pattern-detector adapter ─────────────────────────────────────────────────

import type { PatternResult } from './insight-types'

export function gapResultToPatternResult(
  gapResult: Awaited<ReturnType<typeof analyseGap>>
): PatternResult | null {
  if (!gapResult.has_value_map) return null
  const material = gapResult.gaps.filter(
    (g) => g.gap_severity !== 'low' && g.actual_monthly_spend > 0
  )
  if (material.length === 0) return null
  const biggest = material[0]
  return {
    id: 'value_map_gap',
    score: biggest.gap_severity === 'high' ? 85 : 60,
    layer: 'gap',
    requires: ['transactions', 'value_map'],
    data: {
      category: biggest.category,
      stated: biggest.stated_value_category,
      stated_confidence: biggest.stated_confidence,
      actual_monthly_spend: Math.round(biggest.actual_monthly_spend),
      gap_type: biggest.gap_type,
      narrative: biggest.narrative,
    },
    narrative_prompt:
      `The user labelled ${biggest.category} as ${biggest.stated_value_category} ` +
      `(confidence ${biggest.stated_confidence}/5). Actual pattern: ${biggest.narrative}. ` +
      `Name the gap without judgement. Do not moralise.`,
  }
}

// ── V2 ────────────────────────────────────────────────────────────────────────
//
// analyseGapV2 reads stated values directly from value_map_results (joined
// against SAMPLE_TRANSACTIONS) and emits one of three shapes per category:
//
//   - single_intent : all cards in a category share one quadrant AND are all
//                     'category' granularity → mirrors v1 single-gap behaviour.
//   - multi_intent  : multiple non-unsure quadrants across cards in the same
//                     category, OR a mix of category+intent granularity →
//                     exposes time-slice breakdown rather than claiming a
//                     single gap; the LLM uses label_transactions to resolve.
//   - coverage_gap  : actual spend in a category but no VM card for it →
//                     LLM can ask what this category means.
//
// v1 callers (analyse_gap tool, existing Gap page, gapResultToPatternResult)
// keep using analyseGap. v2 writes to financial_portrait under 'gap_v2_<id>'
// keys to avoid clobbering v1 writes during the cohort overlap.

import { SAMPLE_TRANSACTIONS } from '@/lib/value-map/constants'
import { affectsSpendingBreakdown } from './categories'
import { getTimeContext, type TimeContext } from '@/lib/utils/time-context'
import { normaliseMerchant } from './pattern-detectors'

export type GapShape = 'single_intent' | 'multi_intent' | 'coverage_gap'

export type DecidedQuadrant = 'foundation' | 'investment' | 'burden' | 'leak'

export interface StatedIntent {
  card_label: string                          // e.g. "Dinner out with friends"
  quadrant: DecidedQuadrant
  confidence: number                          // 1-5 from the VM session
}

export interface TimeSliceBreakdown {
  total: number                               // currency spend in this time bucket
  share_pct: number                           // share of category spend
  top_merchants: string[]                     // top 3
  sample_count: number
  sample_transactions: Array<{ id: string; date: string; merchant: string; amount: number }>
}

export interface SingleIntentGapV2 {
  shape: 'single_intent'
  category_id: string
  category_name: string
  stated_quadrant: DecidedQuadrant
  stated_confidence: number                   // avg across contributing cards (1-5)
  actual_monthly_spend: number
  pct_of_total_spending: number
  actual_breakdown: {
    foundation_pct: number
    investment_pct: number
    burden_pct: number
    leak_pct: number
    unsure_pct: number
  }
  gap_type: GapType
  gap_severity: GapSeverity
  top_merchants: Array<{ merchant: string; amount: number }>
  sample_transactions: Array<{ id: string; date: string; merchant: string; amount: number }>
  narrative_hint: string
}

/**
 * Multi-intent learning state. `initial` is the default: not enough confirmed
 * merchant labels yet to tell the user "you've actually been sorting this".
 * `after_labelling` fires once 3+ learned/corrected merchant rules cover ≥70%
 * of the category's spend in the analysis window — at that point the system
 * surfaces the per-quadrant breakdown derived from those labels.
 *
 * Shape mirrors `MultiIntentGapCardLearning` in the renderer:
 *   cfos-office/src/app/(office)/office/values/the-gap/components/MultiIntentGapCard.tsx
 */
export type MultiIntentLearning =
  | { state: 'initial' }
  | {
      state: 'after_labelling'
      learnedMerchants: Array<{
        merchant: string
        reads: 'foundation' | 'investment' | 'leak' | 'burden' | 'unsure'
        count: number
      }>
      claimableGap: Array<{
        label: string
        amount: number
        quadrant: 'foundation' | 'investment' | 'burden' | 'leak'
      }>
      verdict: string
    }

export interface MultiIntentGapV2 {
  shape: 'multi_intent'
  category_id: string
  category_name: string
  stated_intents: StatedIntent[]
  category_monthly_total: number
  pct_of_total_spending: number
  time_slices: Record<string, TimeSliceBreakdown>   // keyed by TimeContext bucket
  skipped_undated_count: number                     // tx with date-only stamps
  narrative_hint: string
  learning: MultiIntentLearning
}

export interface CoverageGapV2 {
  shape: 'coverage_gap'
  category_id: string
  category_name: string
  monthly_total: number
  share_of_spend_pct: number
  narrative_hint: string
}

export type GapV2 = SingleIntentGapV2 | MultiIntentGapV2 | CoverageGapV2

export interface ValueMapMetadata {
  baseline_taken_at: string | null
  classifications_count: number
  decided_count: number
  unsure_count: number
  staleness_days: number
  coverage_pct: number                          // 0-100
  unclassified_categories: string[]             // category_ids where all rows unsure
}

export interface GapAnalysisV2Result {
  gaps: GapV2[]
  value_map_metadata: ValueMapMetadata
  has_value_map: boolean
}

// Minimum monthly spend (in account currency) to surface a coverage_gap.
// Anything below this is micro-category noise that wastes the LLM's attention.
const COVERAGE_GAP_MIN_MONTHLY = 30

// Treat both null and 'unsure' as "no decision". The DB enum has 'unsure' as
// a string value; historical rows may be null. The ValueQuadrant TS type
// doesn't include 'unsure' but it can appear in DB reads.
function isUnsure(quadrant: string | null | undefined): boolean {
  return quadrant === null || quadrant === undefined || quadrant === 'unsure'
}

// Detect whether a tx.date has real time-of-day information. The DB stores
// `date` as a date column (YYYY-MM-DD); when parsed via new Date(yyyy-mm-dd)
// it becomes a midnight-UTC timestamp. Time-of-day bucketing on those rows
// is meaningless — log and skip in multi_intent.
function hasTimeOfDay(rawDate: string): boolean {
  // Treat anything matching ^YYYY-MM-DD$ exactly as date-only.
  return !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Minimum learned-rule coverage of category spend to flip multi_intent into
// the `after_labelling` state. The renderer reads this as "the system has
// learned enough to surface what's actually going on in this category".
const LEARNED_COVERAGE_THRESHOLD = 0.70
// Minimum number of distinct learned merchants to flip — single-merchant
// dominance doesn't tell us about the spread.
const LEARNED_MERCHANT_MIN_COUNT = 3

/**
 * Derive multi-intent learning state from learned merchant rules + the
 * category's spend rows. Exported for direct testing.
 */
export function buildMultiIntentLearning(
  categoryName: string,
  rows: Array<{ description: string; absAmount: number }>,
  rulesByMerchant: Map<string, { quadrant: string; signals: number }>,
  categoryTotal: number,
): MultiIntentLearning {
  if (categoryTotal <= 0) return { state: 'initial' }

  // Aggregate row spend per normalised merchant key.
  const merchantSpend = new Map<string, number>()
  for (const r of rows) {
    const key = normaliseMerchant(r.description) || 'unknown'
    merchantSpend.set(key, (merchantSpend.get(key) ?? 0) + r.absAmount)
  }

  interface LabelledMerchant {
    merchant: string
    amount: number
    quadrant: 'foundation' | 'investment' | 'burden' | 'leak' | 'unsure'
    signals: number
  }
  const labelled: LabelledMerchant[] = []
  for (const [merchant, amount] of merchantSpend.entries()) {
    const rule = rulesByMerchant.get(merchant)
    if (!rule) continue
    const q = rule.quadrant
    if (q !== 'foundation' && q !== 'investment' && q !== 'burden' && q !== 'leak' && q !== 'unsure') continue
    labelled.push({ merchant, amount, quadrant: q, signals: rule.signals })
  }

  const labelledSum = labelled.reduce((s, x) => s + x.amount, 0)
  const coverage = labelledSum / categoryTotal

  if (labelled.length < LEARNED_MERCHANT_MIN_COUNT || coverage < LEARNED_COVERAGE_THRESHOLD) {
    return { state: 'initial' }
  }

  const learnedMerchants = labelled
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((m) => ({ merchant: m.merchant, reads: m.quadrant, count: m.signals }))

  // claimableGap: per-quadrant aggregation. Omit unsure since the renderer
  // type restricts to the 4 decided quadrants.
  const byQuadrant = new Map<'foundation' | 'investment' | 'burden' | 'leak', number>()
  for (const m of labelled) {
    if (m.quadrant === 'unsure') continue
    byQuadrant.set(m.quadrant, (byQuadrant.get(m.quadrant) ?? 0) + m.amount)
  }
  const claimableGap = Array.from(byQuadrant.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([quadrant, amount]) => ({
      label: `${quadrant.charAt(0).toUpperCase()}${quadrant.slice(1)}`,
      amount: round2(amount),
      quadrant,
    }))

  const dominantQuadrant = claimableGap[0]?.quadrant ?? 'foundation'
  const coveragePct = Math.round(coverage * 100)
  const verdict = `${labelled.length} merchants covering ${coveragePct}% of ${categoryName}. Reads mostly ${dominantQuadrant}.`

  return {
    state: 'after_labelling',
    learnedMerchants,
    claimableGap,
    verdict,
  }
}

// Build a quick lookup from sample card id → { category_id, granularity, label }.
function buildSampleCardLookup(): Map<string, { category_id: string; granularity: 'category' | 'intent'; label: string }> {
  const map = new Map<string, { category_id: string; granularity: 'category' | 'intent'; label: string }>()
  for (const card of SAMPLE_TRANSACTIONS) {
    if (!card.category_id || !card.granularity) continue
    map.set(card.id, {
      category_id: card.category_id,
      granularity: card.granularity,
      label: card.description ?? card.id,
    })
  }
  return map
}

export async function analyseGapV2(
  supabase: SupabaseClient,
  userId: string,
  months = 3
): Promise<GapAnalysisV2Result> {
  const empty: GapAnalysisV2Result = {
    gaps: [],
    value_map_metadata: {
      baseline_taken_at: null,
      classifications_count: 0,
      decided_count: 0,
      unsure_count: 0,
      staleness_days: 0,
      coverage_pct: 0,
      unclassified_categories: [],
    },
    has_value_map: false,
  }

  // 1. Read stated values from value_map_results directly.
  const { data: vmRows } = await supabase
    .from('value_map_results')
    .select('transaction_id, quadrant, confidence, created_at')
    .eq('profile_id', userId)
    .is('deleted_at', null)

  if (!vmRows || vmRows.length === 0) {
    return empty
  }

  const hasValueMap = true

  // Learned merchant rules — used to compute multi-intent `after_labelling`
  // state. Pulled once at the top of analyseGapV2 so we don't re-query per
  // category. `source: 'value_map'` rows are excluded because they're sample-
  // card seeds, not user-confirmed corrections.
  const { data: learnedRules } = await supabase
    .from('value_category_rules')
    .select('match_value, value_category, total_signals')
    .eq('user_id', userId)
    .eq('match_type', 'merchant')
    .in('source', ['correction', 'learned'])

  const rulesByMerchant = new Map<string, { quadrant: string; signals: number }>()
  for (const r of learnedRules ?? []) {
    if (!r.match_value || !r.value_category) continue
    rulesByMerchant.set(String(r.match_value).toLowerCase(), {
      quadrant: String(r.value_category),
      signals: typeof r.total_signals === 'number' ? r.total_signals : 1,
    })
  }

  // 2. Join via SAMPLE_TRANSACTIONS lookup. Rows whose transaction_id is not
  //    in the lookup are personal/checkin retake rows (real tx UUIDs) — they
  //    have separate merchant-rule handling (Phase 1.6) and are out of scope
  //    for the V2 analysis driven by sample cards.
  const cardLookup = buildSampleCardLookup()

  interface JoinedRow {
    category_id: string
    granularity: 'category' | 'intent'
    card_label: string
    quadrant: string | null
    confidence: number
    created_at: string
  }

  const joined: JoinedRow[] = []
  for (const row of vmRows) {
    const card = cardLookup.get(row.transaction_id)
    if (!card) continue
    joined.push({
      category_id: card.category_id,
      granularity: card.granularity,
      card_label: card.label,
      quadrant: row.quadrant,
      confidence: typeof row.confidence === 'number' ? row.confidence : Number(row.confidence ?? 0),
      created_at: row.created_at,
    })
  }

  // VM metadata baseline computed over the full vmRows set (not just joined,
  // so a user's retake rows still contribute to baseline / staleness).
  let baselineTakenAt: string | null = null
  for (const r of vmRows) {
    if (!r.created_at) continue
    if (baselineTakenAt === null || r.created_at < baselineTakenAt) {
      baselineTakenAt = r.created_at
    }
  }
  const stalenessDays = baselineTakenAt
    ? Math.max(0, Math.floor((Date.now() - new Date(baselineTakenAt).getTime()) / (24 * 60 * 60 * 1000)))
    : 0

  const decidedAll = vmRows.filter((r) => !isUnsure(r.quadrant)).length
  const unsureAll = vmRows.length - decidedAll

  if (joined.length === 0) {
    // VM exists but no sample-card rows (e.g. entirely retake/personal data).
    return {
      ...empty,
      has_value_map: hasValueMap,
      value_map_metadata: {
        baseline_taken_at: baselineTakenAt,
        classifications_count: vmRows.length,
        decided_count: decidedAll,
        unsure_count: unsureAll,
        staleness_days: stalenessDays,
        coverage_pct: 0,
        unclassified_categories: [],
      },
    }
  }

  // 3. Group by category_id.
  const byCategory = new Map<string, JoinedRow[]>()
  for (const r of joined) {
    const existing = byCategory.get(r.category_id)
    if (existing) existing.push(r)
    else byCategory.set(r.category_id, [r])
  }

  // 4. Fetch transactions for the window. Expenses only, deleted_at null.
  const sinceDate = new Date()
  sinceDate.setMonth(sinceDate.getMonth() - months)
  const since = sinceDate.toISOString().slice(0, 10)

  const { data: transactions } = await supabase
    .from('transactions')
    .select('id, amount, description, date, category_id, value_category')
    .eq('user_id', userId)
    .lt('amount', 0)
    .gte('date', since)
    .is('deleted_at', null)

  const txs = (transactions ?? []).filter((t) => affectsSpendingBreakdown(t.category_id))

  // 5. Compute actual spend per category (over the window).
  interface CategoryAgg {
    total: number
    by_value: Record<string, number>
    rows: Array<{
      id: string
      date: string
      description: string
      amount: number
      absAmount: number
      value_category: string | null
    }>
  }

  const catAggs = new Map<string, CategoryAgg>()
  let totalSpend = 0
  for (const t of txs) {
    const catId = (t.category_id ?? '_unknown') as string
    const amount = Number(t.amount)
    const abs = Math.abs(amount)
    totalSpend += abs

    const existing = catAggs.get(catId) ?? { total: 0, by_value: {}, rows: [] }
    existing.total += abs
    const vc = (t.value_category ?? 'unsure') as string
    existing.by_value[vc] = (existing.by_value[vc] ?? 0) + abs
    existing.rows.push({
      id: t.id,
      date: t.date,
      description: t.description ?? 'Unknown',
      amount,
      absAmount: abs,
      value_category: t.value_category ?? null,
    })
    catAggs.set(catId, existing)
  }

  const monthDivisor = Math.max(months, 1)
  const gaps: GapV2[] = []
  const unclassifiedCategories: string[] = []
  const statedCategorySet = new Set<string>()

  // 6. Per-category branching: single_intent / multi_intent / all-unsure.
  for (const [categoryId, rows] of byCategory.entries()) {
    statedCategorySet.add(categoryId)

    const decided = rows.filter((r) => !isUnsure(r.quadrant))
    const allUnsure = decided.length === 0

    if (allUnsure) {
      unclassifiedCategories.push(categoryId)
      continue
    }

    // Determine shape.
    const quadrantSet = new Set(decided.map((r) => r.quadrant))
    const hasCategory = decided.some((r) => r.granularity === 'category')
    const hasIntent = decided.some((r) => r.granularity === 'intent')
    const allCategory = hasCategory && !hasIntent
    const singleQuadrant = quadrantSet.size === 1

    const agg = catAggs.get(categoryId)
    const categoryName = categoryId // display name; the categories table join is
                                    // intentionally omitted to stay query-light. The LLM
                                    // can refer to category_id directly; consumers needing
                                    // friendly names can join with the categories table.

    if (singleQuadrant && allCategory) {
      // single_intent — mirror v1 behaviour.
      const stated = decided[0].quadrant as DecidedQuadrant
      const avgConfidence = decided.reduce((s, r) => s + r.confidence, 0) / decided.length

      if (!agg || agg.total === 0) {
        // Stated investment with no spending → undervalued.
        if (stated === 'investment') {
          gaps.push({
            shape: 'single_intent',
            category_id: categoryId,
            category_name: categoryName,
            stated_quadrant: stated,
            stated_confidence: avgConfidence,
            actual_monthly_spend: 0,
            pct_of_total_spending: 0,
            actual_breakdown: {
              foundation_pct: 0,
              investment_pct: 0,
              burden_pct: 0,
              leak_pct: 0,
              unsure_pct: 0,
            },
            gap_type: 'undervalued',
            gap_severity: 'medium',
            top_merchants: [],
            sample_transactions: [],
            narrative_hint: firstSentence(
              buildNarrative('undervalued', categoryName, 0, 0, avgConfidence),
            ),
          })
        }
        continue
      }

      const pct = totalSpend > 0 ? (agg.total / totalSpend) * 100 : 0
      const monthlySpend = agg.total / monthDivisor
      const vTotal = Object.values(agg.by_value).reduce((s, v) => s + v, 0) || 1
      const breakdown = {
        foundation_pct: round1(((agg.by_value.foundation ?? 0) / vTotal) * 100),
        investment_pct: round1(((agg.by_value.investment ?? 0) / vTotal) * 100),
        burden_pct: round1(((agg.by_value.burden ?? 0) / vTotal) * 100),
        leak_pct: round1(((agg.by_value.leak ?? 0) / vTotal) * 100),
        unsure_pct: round1(((agg.by_value.unsure ?? 0) / vTotal) * 100),
      }

      const { gap_type, gap_severity } = classifyGap(stated, pct)

      // Top merchants + sample transactions (largest absolute spend first).
      const merchantTotals = new Map<string, { merchant: string; amount: number }>()
      for (const r of agg.rows) {
        const key = normaliseMerchant(r.description) || 'unknown'
        const existing = merchantTotals.get(key)
        if (existing) existing.amount += r.absAmount
        else merchantTotals.set(key, { merchant: key, amount: r.absAmount })
      }
      const top_merchants = Array.from(merchantTotals.values())
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3)
        .map((m) => ({ merchant: m.merchant, amount: round2(m.amount) }))

      const sample_transactions = agg.rows
        .slice()
        .sort((a, b) => b.absAmount - a.absAmount)
        .slice(0, 3)
        .map((r) => ({
          id: r.id,
          date: r.date,
          merchant: r.description,
          amount: round2(r.amount),
        }))

      gaps.push({
        shape: 'single_intent',
        category_id: categoryId,
        category_name: categoryName,
        stated_quadrant: stated,
        stated_confidence: avgConfidence,
        actual_monthly_spend: round2(monthlySpend),
        pct_of_total_spending: round1(pct),
        actual_breakdown: breakdown,
        gap_type,
        gap_severity,
        top_merchants,
        sample_transactions,
        narrative_hint: firstSentence(
          buildNarrative(gap_type, categoryName, monthlySpend, pct, avgConfidence),
        ),
      })
      continue
    }

    // multi_intent — multiple distinct quadrants OR mix of granularities.
    const statedIntents: StatedIntent[] = decided.map((r) => ({
      card_label: r.card_label,
      quadrant: r.quadrant as DecidedQuadrant,
      confidence: r.confidence,
    }))

    if (!agg || agg.total === 0) {
      // No actual spend in this category — still surface the stated disagreement
      // so the LLM knows the user has mixed feelings here. Time slices empty.
      gaps.push({
        shape: 'multi_intent',
        category_id: categoryId,
        category_name: categoryName,
        stated_intents: statedIntents,
        category_monthly_total: 0,
        pct_of_total_spending: 0,
        time_slices: {},
        skipped_undated_count: 0,
        narrative_hint:
          'Multiple stated intents for this category; ask the user which transactions belong to which intent rather than claiming a single gap.',
        learning: { state: 'initial' },
      })
      continue
    }

    const pct = totalSpend > 0 ? (agg.total / totalSpend) * 100 : 0
    const monthlyTotal = agg.total / monthDivisor

    // Bucket rows by time-of-day context. Skip date-only rows.
    let skippedUndated = 0
    interface BucketData {
      total: number
      rows: Array<{ id: string; date: string; description: string; amount: number; absAmount: number }>
    }
    const buckets = new Map<TimeContext, BucketData>()

    for (const r of agg.rows) {
      if (!hasTimeOfDay(r.date)) {
        skippedUndated += 1
        continue
      }
      const ts = new Date(r.date)
      if (!Number.isFinite(ts.getTime())) {
        skippedUndated += 1
        continue
      }
      const bucket = getTimeContext(ts)
      const existing = buckets.get(bucket) ?? { total: 0, rows: [] }
      existing.total += r.absAmount
      existing.rows.push({
        id: r.id,
        date: r.date,
        description: r.description,
        amount: r.amount,
        absAmount: r.absAmount,
      })
      buckets.set(bucket, existing)
    }

    if (skippedUndated > 0) {
      console.warn(
        `[gap-analyser-v2] Skipped ${skippedUndated} date-only transactions for category ${categoryId} in multi_intent time-slice computation.`,
      )
    }

    const datedTotal = Array.from(buckets.values()).reduce((s, b) => s + b.total, 0)
    const time_slices: Record<string, TimeSliceBreakdown> = {}
    for (const [bucket, data] of buckets.entries()) {
      // Merchant totals within bucket.
      const mTotals = new Map<string, number>()
      for (const r of data.rows) {
        const key = normaliseMerchant(r.description) || 'unknown'
        mTotals.set(key, (mTotals.get(key) ?? 0) + r.absAmount)
      }
      const topMerchants = Array.from(mTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([m]) => m)

      const sampleTxs = data.rows
        .slice()
        .sort((a, b) => b.absAmount - a.absAmount)
        .slice(0, 3)
        .map((r) => ({
          id: r.id,
          date: r.date,
          merchant: r.description,
          amount: round2(r.amount),
        }))

      time_slices[bucket] = {
        total: round2(data.total),
        share_pct: datedTotal > 0 ? round1((data.total / datedTotal) * 100) : 0,
        top_merchants: topMerchants,
        sample_count: data.rows.length,
        sample_transactions: sampleTxs,
      }
    }

    const learning = buildMultiIntentLearning(
      categoryName,
      agg.rows,
      rulesByMerchant,
      agg.total,
    )

    gaps.push({
      shape: 'multi_intent',
      category_id: categoryId,
      category_name: categoryName,
      stated_intents: statedIntents,
      category_monthly_total: round2(monthlyTotal),
      pct_of_total_spending: round1(pct),
      time_slices,
      skipped_undated_count: skippedUndated,
      narrative_hint:
        'Multiple stated intents for this category; ask the user which transactions belong to which intent rather than claiming a single gap.',
      learning,
    })
  }

  // 7. Coverage gaps — categories with actual spend but no VM card.
  for (const [categoryId, agg] of catAggs.entries()) {
    if (statedCategorySet.has(categoryId)) continue
    if (!affectsSpendingBreakdown(categoryId)) continue
    if (categoryId === '_unknown') continue
    const monthly = agg.total / monthDivisor
    if (monthly < COVERAGE_GAP_MIN_MONTHLY) continue
    const pct = totalSpend > 0 ? (agg.total / totalSpend) * 100 : 0
    gaps.push({
      shape: 'coverage_gap',
      category_id: categoryId,
      category_name: categoryId,
      monthly_total: round2(monthly),
      share_of_spend_pct: round1(pct),
      narrative_hint:
        "Not in user's Value Map; invite them to share what this category means.",
    })
  }

  // 8. Write portrait entries (V2-scoped keys to avoid clobbering v1).
  for (const gap of gaps) {
    if (gap.shape === 'single_intent') {
      // Only persist material single-intent gaps (skip 'aligned' low-severity).
      if (gap.gap_severity === 'low') continue
      await supabase.from('financial_portrait').upsert(
        {
          user_id: userId,
          trait_type: 'gap_analysis',
          trait_key: `gap_v2_${gap.category_id}`,
          trait_value: gap.narrative_hint,
          confidence: gap.gap_severity === 'high' ? 0.9 : 0.7,
          evidence: JSON.stringify({
            shape: 'single_intent',
            gap_type: gap.gap_type,
            stated_quadrant: gap.stated_quadrant,
            actual_spend_pct: gap.pct_of_total_spending,
            actual_monthly_spend: gap.actual_monthly_spend,
            breakdown: gap.actual_breakdown,
          }),
          source: 'gap_analysis',
        },
        { onConflict: 'user_id,trait_key' },
      )
    } else if (gap.shape === 'multi_intent') {
      await supabase.from('financial_portrait').upsert(
        {
          user_id: userId,
          trait_type: 'gap_invitation',
          trait_key: `gap_v2_${gap.category_id}`,
          trait_value: gap.narrative_hint,
          confidence: 0.7,
          evidence: JSON.stringify({
            shape: 'multi_intent',
            stated_intents: gap.stated_intents,
            category_monthly_total: gap.category_monthly_total,
            time_slice_keys: Object.keys(gap.time_slices),
          }),
          source: 'gap_analysis',
        },
        { onConflict: 'user_id,trait_key' },
      )
    } else if (gap.shape === 'coverage_gap') {
      await supabase.from('financial_portrait').upsert(
        {
          user_id: userId,
          trait_type: 'gap_coverage',
          trait_key: `gap_v2_${gap.category_id}`,
          trait_value: gap.narrative_hint,
          confidence: 0.6,
          evidence: JSON.stringify({
            shape: 'coverage_gap',
            monthly_total: gap.monthly_total,
            share_of_spend_pct: gap.share_of_spend_pct,
          }),
          source: 'gap_analysis',
        },
        { onConflict: 'user_id,trait_key' },
      )
    }
  }

  // Same as v1: the traits above only reach the CFO through the Values digest.
  if (gaps.length > 0) await refreshMemoryDigests(supabase, userId)

  // 9. Build metadata envelope.
  const actualCategoriesSet = new Set<string>()
  for (const catId of catAggs.keys()) {
    if (catId === '_unknown') continue
    if (!affectsSpendingBreakdown(catId)) continue
    actualCategoriesSet.add(catId)
  }
  const coveragePct =
    actualCategoriesSet.size > 0
      ? Math.round(
          (Array.from(statedCategorySet).filter((c) => actualCategoriesSet.has(c)).length /
            actualCategoriesSet.size) *
            1000,
        ) / 10
      : 0

  return {
    gaps,
    value_map_metadata: {
      baseline_taken_at: baselineTakenAt,
      classifications_count: vmRows.length,
      decided_count: decidedAll,
      unsure_count: unsureAll,
      staleness_days: stalenessDays,
      coverage_pct: coveragePct,
      unclassified_categories: unclassifiedCategories,
    },
    has_value_map: hasValueMap,
  }
}

// Trim a multi-sentence narrative to a single LLM-facing frame.
function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]+[.!?]/)
  return (match ? match[0] : text).trim()
}
