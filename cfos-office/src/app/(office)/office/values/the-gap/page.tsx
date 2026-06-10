import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { analyseGapV2 } from '@/lib/analytics/gap-analyser'
import type { GapV2 } from '@/lib/analytics/gap-analyser'
import { bucketVmRowsByQuadrant } from '@/lib/ai/context-builder'
import { TheGapV2Client } from './TheGapV2Client'
import type { VmRowsByQuadrant } from './components/ValueMapSummary'

export default async function TheGapPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch profile (currency) and VM/tx counts in parallel.
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

  // Three-shape rendering with ValueMapSummary (Chat Intelligence v2).
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
