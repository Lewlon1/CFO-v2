import { createClient } from '@/lib/supabase/server'
import { ArchetypePageClient, type TimelineEntry } from '@/components/values/ArchetypePageClient'

export const dynamic = 'force-dynamic'

export default async function ArchetypePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Latest session that has an archetype populated — this is the "current" view.
  const { data: currentSession } = await supabase
    .from('value_map_sessions')
    .select('session_number, type, created_at, archetype_name, archetype_subtitle, archetype_analysis, archetype_traits, certainty_areas, conflict_areas, archetype_history, shift_narrative, trigger_reason')
    .eq('profile_id', user.id)
    .not('archetype_name', 'is', null)
    .is('deleted_at', null)
    .order('session_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Most recent session overall — used to detect a personal retake that's still
  // mid-regeneration (session row exists, archetype_name not written yet).
  const { data: latestAny } = await supabase
    .from('value_map_sessions')
    .select('session_number, type, created_at, archetype_name')
    .eq('profile_id', user.id)
    .is('deleted_at', null)
    .order('session_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const pendingRegen = Boolean(
    latestAny &&
      !latestAny.archetype_name &&
      latestAny.type === 'personal' &&
      // only poll while the row is fresh — avoids perpetual polling on an orphan
      Date.now() - new Date(latestAny.created_at).getTime() < 10 * 60 * 1000,
  )

  if (!currentSession) {
    return <ArchetypePageClient data={null} timeline={[]} pendingRegen={pendingRegen} />
  }

  // archetype_history entries are archived older versions of this user's archetype.
  // Shape stored by regenerateArchetype: { version, name, subtitle, traits, archived_at }
  const historyRaw = Array.isArray(currentSession.archetype_history)
    ? (currentSession.archetype_history as Array<Record<string, unknown>>)
    : []

  const historyEntries: TimelineEntry[] = historyRaw.map((h) => ({
    version: typeof h.version === 'number' ? h.version : null,
    name: typeof h.name === 'string' ? h.name : 'Unknown',
    subtitle: typeof h.subtitle === 'string' ? h.subtitle : null,
    traits: Array.isArray(h.traits) ? (h.traits as unknown[]).filter((t): t is string => typeof t === 'string') : [],
    archived_at: typeof h.archived_at === 'string' ? h.archived_at : null,
    isCurrent: false,
  }))

  const currentEntry: TimelineEntry = {
    version: currentSession.session_number ?? null,
    name: currentSession.archetype_name ?? 'Unknown',
    subtitle: currentSession.archetype_subtitle ?? null,
    traits: Array.isArray(currentSession.archetype_traits)
      ? (currentSession.archetype_traits as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    archived_at: currentSession.created_at ?? null,
    isCurrent: true,
  }

  // Oldest → newest for the timeline; client renders newest-first for display.
  const timeline: TimelineEntry[] = [...historyEntries, currentEntry]

  const data = {
    archetype_name: currentSession.archetype_name,
    archetype_subtitle: currentSession.archetype_subtitle,
    full_analysis: currentSession.archetype_analysis,
    certainty_areas: (currentSession.certainty_areas as string[] | null) ?? null,
    conflict_areas: (currentSession.conflict_areas as string[] | null) ?? null,
    comfort_patterns: null,
    session_number: currentSession.session_number ?? null,
    updated_at: currentSession.created_at ?? null,
    shift_narrative: currentSession.shift_narrative ?? null,
  }

  return (
    <ArchetypePageClient data={data} timeline={timeline} pendingRegen={pendingRegen} />
  )
}
