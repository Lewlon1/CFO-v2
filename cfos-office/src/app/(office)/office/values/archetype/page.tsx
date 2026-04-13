import { createClient } from '@/lib/supabase/server'
import { ArchetypePageClient } from '@/components/values/ArchetypePageClient'

export default async function ArchetypePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('value_map_results')
    .select('archetype_name, archetype_subtitle, full_analysis, certainty_areas, conflict_areas, comfort_patterns')
    .eq('user_id', user.id)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return <ArchetypePageClient data={data} />
}
