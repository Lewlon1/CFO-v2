import { createClient } from '@/lib/supabase/server'
import { calculateCompleteness } from '@/lib/profile/completeness'
import { ValuesDashboard, type ValuesDashboardGap } from '@/components/office/dashboards/ValuesDashboard'

export const dynamic = 'force-dynamic'

function humaniseSlug(slug: string): string {
  return slug
    .replace(/^gap_/, '')
    .replace(/^merchant:/, '')
    .split(/[_\s]/g)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

export default async function ValuesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [profileResult, sessionResult, gapsResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single(),
    supabase
      .from('value_map_sessions')
      .select('archetype_name, archetype_subtitle, archetype_traits, session_number')
      .eq('profile_id', user.id)
      .not('archetype_name', 'is', null)
      .is('deleted_at', null)
      .order('session_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('financial_portrait')
      .select('trait_key, trait_value, confidence')
      .eq('user_id', user.id)
      .eq('trait_type', 'gap_analysis')
      .is('dismissed_at', null)
      .order('confidence', { ascending: false })
      .limit(3),
  ])

  const currency = profileResult.data?.primary_currency ?? 'EUR'
  const profileCompleteness = profileResult.data
    ? calculateCompleteness(profileResult.data as Record<string, unknown>)
    : 0

  const archetype = sessionResult.data?.archetype_name
    ? {
        name: sessionResult.data.archetype_name,
        subtitle: sessionResult.data.archetype_subtitle ?? null,
        traits: Array.isArray(sessionResult.data.archetype_traits)
          ? (sessionResult.data.archetype_traits as unknown[]).filter(
              (t): t is string => typeof t === 'string',
            )
          : [],
        version: sessionResult.data.session_number ?? null,
      }
    : null

  const gaps: ValuesDashboardGap[] = (gapsResult.data ?? []).map((g) => ({
    label: humaniseSlug(g.trait_key ?? ''),
    narrative: g.trait_value ?? '',
  }))

  return (
    <ValuesDashboard
      currency={currency}
      archetype={archetype}
      gaps={gaps}
      profileCompleteness={profileCompleteness}
    />
  )
}
