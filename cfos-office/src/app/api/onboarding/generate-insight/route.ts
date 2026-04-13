import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bedrock } from '@/lib/ai/provider'
import { logChatUsage } from '@/lib/chat/cost-tracker'
import { analyseGap, type CategoryGap } from '@/lib/analytics/gap-analyser'
import {
  buildInsightPrompt,
  buildTemplateFallback,
  type FirstInsightData,
} from '@/lib/onboarding/insight-prompt'

const BEDROCK_MODEL = process.env.BEDROCK_CLAUDE_MODEL ?? 'eu.anthropic.claude-sonnet-4-6'
const TIMEOUT_MS = 12_000

// ── Currency helpers ──────────────────────────────────────────────────────────

function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }
  return symbols[currency] ?? currency
}

// ── Compute first insight data from gap analysis ────────────────────────────

function gapToInsightData(gap: CategoryGap, currency: string): FirstInsightData {
  const sym = getCurrencySymbol(currency)
  const annual = gap.actual_monthly_spend * 12

  return {
    type: gap.gap_type === 'aligned' ? 'confirmation' : 'gap',
    merchant_or_category: gap.category,
    user_believed: {
      category: gap.stated_value_category,
      confidence: gap.stated_confidence * 5, // normalize 0-1 to 1-5
    },
    reality: {
      description: gap.narrative,
      monthly_amount: gap.actual_monthly_spend,
      trend: gap.actual_monthly_spend === 0 ? 'inactive' : 'stable',
    },
    financial_impact:
      gap.actual_monthly_spend > 0
        ? {
            annual_amount: Math.round(annual * 100) / 100,
            description: `${sym}${annual.toFixed(0)}`,
          }
        : undefined,
  }
}

// ── Compute fallback: top spending category ─────────────────────────────────

async function computeSpendingSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  importBatchId: string,
  currency: string,
): Promise<FirstInsightData | null> {
  const sym = getCurrencySymbol(currency)

  // Get top spending category from this batch
  const { data: topCategory } = await supabase
    .from('transactions')
    .select('category_id, amount')
    .eq('user_id', userId)
    .eq('import_batch_id', importBatchId)
    .lt('amount', 0) // expenses only

  if (!topCategory || topCategory.length === 0) return null

  // Group by category
  const byCat = new Map<string, number>()
  for (const tx of topCategory) {
    const cat = tx.category_id ?? 'uncategorised'
    byCat.set(cat, (byCat.get(cat) ?? 0) + Math.abs(tx.amount))
  }

  // Find top
  let topCatId = ''
  let topAmount = 0
  for (const [cat, amount] of byCat) {
    if (amount > topAmount) {
      topCatId = cat
      topAmount = amount
    }
  }

  // Get category name
  let catName = topCatId
  if (topCatId && topCatId !== 'uncategorised') {
    const { data: catData } = await supabase
      .from('categories')
      .select('name')
      .eq('id', topCatId)
      .single()
    if (catData) catName = catData.name
  }

  // Count months in the batch for monthly average
  const { data: dateRange } = await supabase
    .from('transactions')
    .select('date')
    .eq('user_id', userId)
    .eq('import_batch_id', importBatchId)
    .order('date', { ascending: true })
    .limit(1)

  const { data: dateRangeEnd } = await supabase
    .from('transactions')
    .select('date')
    .eq('user_id', userId)
    .eq('import_batch_id', importBatchId)
    .order('date', { ascending: false })
    .limit(1)

  let months = 1
  if (dateRange?.[0]?.date && dateRangeEnd?.[0]?.date) {
    const start = new Date(dateRange[0].date)
    const end = new Date(dateRangeEnd[0].date)
    months = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (30 * 24 * 60 * 60 * 1000)))
  }

  const monthlyAmount = topAmount / months
  const annual = monthlyAmount * 12

  return {
    type: 'summary',
    merchant_or_category: catName,
    reality: {
      description: `Your biggest spending category is ${catName} at ${sym}${monthlyAmount.toFixed(0)}/month`,
      monthly_amount: Math.round(monthlyAmount * 100) / 100,
    },
    financial_impact: {
      annual_amount: Math.round(annual * 100) / 100,
      description: `${sym}${annual.toFixed(0)}`,
    },
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const startTime = Date.now()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { import_batch_id } = (await req.json()) as { import_batch_id?: string }

  if (!import_batch_id) {
    return NextResponse.json({ error: 'Missing import_batch_id' }, { status: 400 })
  }

  // ── Get user profile for currency and archetype ───────────────────────────

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('currency')
    .eq('id', user.id)
    .single()

  const currency = profile?.currency ?? 'GBP'
  const sym = getCurrencySymbol(currency)

  // Get archetype name for the prompt
  const { data: vmResult } = await supabase
    .from('value_map_results')
    .select('archetype_name')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const archetypeName = vmResult?.archetype_name ?? 'your CFO'

  // ── Compute insight data ──────────────────────────────────────────────────

  let insightData: FirstInsightData | null = null

  // Try gap analysis first (requires Value Map + transactions)
  try {
    const gapResult = await analyseGap(supabase, user.id, 3)
    if (gapResult.gaps.length > 0) {
      // Pick the highest-severity non-aligned gap
      const topGap = gapResult.gaps.find((g) => g.gap_type !== 'aligned') ?? gapResult.gaps[0]
      insightData = gapToInsightData(topGap, currency)
    }
  } catch (err) {
    console.warn('[insight] Gap analysis failed, falling back to summary:', err)
  }

  // Fallback: general spending summary
  if (!insightData) {
    insightData = await computeSpendingSummary(supabase, user.id, import_batch_id, currency)
  }

  if (!insightData) {
    return NextResponse.json({
      narrative: null,
      type: null,
      error: 'No transaction data available for insight generation',
    })
  }

  // ── Generate LLM narrative ────────────────────────────────────────────────

  let narrative: string

  try {
    const prompt = buildInsightPrompt(
      insightData,
      'there', // don't need name in the insight card
      archetypeName,
      sym,
    )

    const result = await Promise.race([
      generateText({
        model: bedrock(BEDROCK_MODEL),
        prompt,
        maxOutputTokens: 512,
        temperature: 0.6,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bedrock timeout')), TIMEOUT_MS),
      ),
    ])

    narrative = result.text.trim()

    // Sanity check: narrative should be reasonable length
    if (narrative.length < 20 || narrative.length > 1000) {
      console.warn('[insight] Narrative length unexpected:', narrative.length)
      narrative = buildTemplateFallback(insightData, sym)
    }
  } catch (err) {
    console.error('[insight] Bedrock error:', err instanceof Error ? err.message : err)
    narrative = buildTemplateFallback(insightData, sym)
  }

  // ── Log usage ─────────────────────────────────────────────────────────────

  await logChatUsage({
    profileId: user.id,
    action: 'first_insight_generation',
    model: BEDROCK_MODEL,
    durationMs: Date.now() - startTime,
  }).catch(() => {})

  return NextResponse.json({
    narrative,
    type: insightData.type,
    insightData,
  })
}
