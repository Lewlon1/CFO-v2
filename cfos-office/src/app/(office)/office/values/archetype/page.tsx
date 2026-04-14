import { createClient } from '@/lib/supabase/server'
import { ArchetypePageClient } from '@/components/values/ArchetypePageClient'

export default async function ArchetypePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Archetype data lives on value_map_sessions (keyed by profile_id).
  // The latest session with a populated archetype_name is the one to show.
  const { data: session } = await supabase
    .from('value_map_sessions')
    .select('archetype_name, archetype_subtitle, archetype_analysis, certainty_areas, conflict_areas')
    .eq('profile_id', user.id)
    .not('archetype_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Map schema columns to the shape ArchetypePageClient expects.
  // `full_analysis` ← `archetype_analysis`; `comfort_patterns` isn't stored, pass null.
  const data = session
    ? {
        archetype_name: session.archetype_name,
        archetype_subtitle: session.archetype_subtitle,
        full_analysis: session.archetype_analysis,
        certainty_areas: (session.certainty_areas as string[] | null) ?? null,
        conflict_areas: (session.conflict_areas as string[] | null) ?? null,
        comfort_patterns: null,
      }
    : null

  return <ArchetypePageClient data={data} />
}
