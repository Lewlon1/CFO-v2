import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { regenerateArchetype } from '@/lib/value-map/regenerate-archetype'

// POST /api/value-map/regenerate-archetype
//
// Manual re-generation trigger. The CFO can call this from a chat tool, or
// the user can push a button on the archetype page.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await regenerateArchetype(supabase, user.id, 'manual')

  if (!result) {
    return NextResponse.json(
      { error: 'Not enough data to regenerate yet.' },
      { status: 409 },
    )
  }

  return NextResponse.json({
    archetype_name: result.archetype_name,
    archetype_subtitle: result.archetype_subtitle,
    traits: result.traits,
    shift_narrative: result.shift_narrative,
    certainty_areas: result.certainty_areas,
    conflict_areas: result.conflict_areas,
    version: result.version,
    used_fallback: result.used_fallback,
  })
}
