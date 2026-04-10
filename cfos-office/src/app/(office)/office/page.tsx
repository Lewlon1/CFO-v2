import { createClient } from '@/lib/supabase/server'
import { OfficeHomeClient } from './OfficeHomeClient'

export default async function OfficePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  // Fetch server-side data in parallel
  const [
    provenanceResult,
    gapsResult,
    archetypeResult,
    assetsResult,
    liabilitiesResult,
    tripResult,
    profileResult,
  ] = await Promise.all([
    // Provenance: most common source + latest upload date
    supabase
      .from('transactions')
      .select('source, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1),

    // Gap analysis items
    supabase
      .from('financial_portrait')
      .select('trait_key, trait_value')
      .eq('user_id', user.id)
      .eq('trait_type', 'gap_analysis')
      .is('dismissed_at', null)
      .order('confidence', { ascending: false })
      .limit(2),

    // Archetype from value map
    supabase
      .from('value_map_results')
      .select('archetype_name, archetype_subtitle')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Total assets
    supabase
      .from('assets')
      .select('current_value')
      .eq('user_id', user.id),

    // Total liabilities
    supabase
      .from('liabilities')
      .select('outstanding_balance')
      .eq('user_id', user.id),

    // Next trip
    supabase
      .from('trips')
      .select('name, start_date, end_date, total_estimated, currency')
      .eq('user_id', user.id)
      .gt('start_date', new Date().toISOString().split('T')[0])
      .neq('status', 'cancelled')
      .order('start_date', { ascending: true })
      .limit(1)
      .maybeSingle(),

    // User currency preference
    supabase
      .from('user_profiles')
      .select('currency')
      .eq('id', user.id)
      .single(),
  ])

  const provenance = provenanceResult.data?.[0]
    ? { source: provenanceResult.data[0].source, uploadDate: provenanceResult.data[0].created_at }
    : undefined

  const gaps = (gapsResult.data ?? []).map(g => ({
    trait_key: g.trait_key,
    trait_value: g.trait_value,
  }))

  const archetype = archetypeResult.data
    ? { archetype_name: archetypeResult.data.archetype_name, archetype_subtitle: archetypeResult.data.archetype_subtitle }
    : null

  const totalAssets = (assetsResult.data ?? []).reduce((sum, a) => sum + (a.current_value ?? 0), 0)
  const totalLiabilities = (liabilitiesResult.data ?? []).reduce((sum, l) => sum + (l.outstanding_balance ?? 0), 0)
  const hasBalanceSheet = (assetsResult.data?.length ?? 0) > 0 || (liabilitiesResult.data?.length ?? 0) > 0

  const nextTrip = tripResult.data ?? null

  const currency = profileResult.data?.currency ?? 'EUR'

  return (
    <OfficeHomeClient
      provenance={provenance}
      gaps={gaps}
      archetype={archetype}
      totalAssets={totalAssets}
      totalLiabilities={totalLiabilities}
      hasBalanceSheet={hasBalanceSheet}
      nextTrip={nextTrip}
      currency={currency}
    />
  )
}
