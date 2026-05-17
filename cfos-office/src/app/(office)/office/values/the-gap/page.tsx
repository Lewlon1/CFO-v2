import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { analyseGap, analyseGapV2 } from '@/lib/analytics/gap-analyser'
import type { GapType, GapV2 } from '@/lib/analytics/gap-analyser'
import { isChatIntelligenceV2Enabled } from '@/lib/features/chat-intelligence-v2'
import { bucketVmRowsByQuadrant } from '@/lib/ai/context-builder'
import { TheGapClient } from './TheGapClient'
import { TheGapV2Client } from './TheGapV2Client'
import type { VmRowsByQuadrant } from './components/ValueMapSummary'

function mapGapStatus(gapType: GapType): 'aligned' | 'gap' | 'eliminated' | 'partial' {
  switch (gapType) {
    case 'aligned': return 'aligned'
    case 'leaking_despite_awareness': return 'gap'
    case 'undervalued': return 'eliminated'
    case 'over_investing':
    case 'hidden_burden':
    default: return 'partial'
  }
}

export default async function TheGapPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch profile (beta_cohort gate + currency) and VM/tx counts in parallel.
  const [
    profileResult,
    txCountResult,
    valueMapCountResult,
  ] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('beta_cohort, primary_currency')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('value_map_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', user.id),
  ])

  const profile = profileResult.data
  const currency = profile?.primary_currency ?? 'EUR'
  const transactionCount = txCountResult.count ?? 0
  const hasValueMap = (valueMapCountResult.count ?? 0) > 0

  // Cohort gate: wave_1 / wave_1_5 (or CHAT_INTELLIGENCE_V2_FORCE) get the
  // new three-shape rendering with ValueMapSummary. Everyone else keeps the
  // existing GapCard rendering.
  if (isChatIntelligenceV2Enabled(profile)) {
    const v2Result = await analyseGapV2(supabase, user.id, 3)

    // Build the per-quadrant friendly labels for the header summary block —
    // same helper the brief builder uses, so labels here match what the LLM
    // sees in the v2 first-insight prompt.
    let vmRowsByQuadrant: VmRowsByQuadrant = {
      foundation: [],
      investment: [],
      leak: [],
      burden: [],
      unsure: [],
    }
    if (v2Result.has_value_map) {
      const { data: vmRows } = await supabase
        .from('value_map_results')
        .select('transaction_id, merchant, quadrant')
        .eq('profile_id', user.id)
        .is('deleted_at', null)
      if (Array.isArray(vmRows)) {
        vmRowsByQuadrant = bucketVmRowsByQuadrant(vmRows)
      }
    }

    // Resolve category friendly names — analyseGapV2 stamps category_name to
    // the slug, but the categories table holds the display name. Pre-resolve
    // here so the cards don't each take a round-trip.
    const slugs = Array.from(new Set(v2Result.gaps.map((g) => g.category_id)))
    let nameMap = new Map<string, string>()
    if (slugs.length > 0) {
      const { data: catRows } = await supabase
        .from('categories')
        .select('id, name')
        .in('id', slugs)
      if (Array.isArray(catRows)) {
        nameMap = new Map(catRows.map((c) => [c.id, c.name]))
      }
    }
    const gapsWithNames: GapV2[] = v2Result.gaps.map((g) => ({
      ...g,
      category_name: nameMap.get(g.category_id) ?? g.category_name,
    }))

    return (
      <TheGapV2Client
        gaps={gapsWithNames}
        metadata={v2Result.value_map_metadata}
        vmRowsByQuadrant={vmRowsByQuadrant}
        currency={currency}
        transactionCount={transactionCount}
        hasValueMap={hasValueMap}
      />
    )
  }

  // ── v1 path ──────────────────────────────────────────────────────────────
  const result = await analyseGap(supabase, user.id, 3)

  const gaps = result.gaps.map(g => ({
    trait_key: g.category_slug,
    trait_value: JSON.stringify({
      belief: `You said ${g.category} is ${g.stated_value_category} (${g.stated_confidence}/5)`,
      reality: g.narrative,
      status: mapGapStatus(g.gap_type),
    }),
    confidence: g.stated_confidence,
  }))

  return (
    <TheGapClient
      gaps={gaps}
      transactionCount={transactionCount}
      hasValueMap={hasValueMap}
    />
  )
}
