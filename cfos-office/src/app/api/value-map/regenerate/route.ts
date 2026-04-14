import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { regenerateArchetype } from '@/lib/value-map/regenerate-archetype'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await regenerateArchetype(supabase, user.id, 'manual')
  if (!result) {
    return NextResponse.json({ error: 'Not enough data to generate archetype' }, { status: 422 })
  }

  return NextResponse.json({ ok: true, archetype_name: result.archetype_name })
}
