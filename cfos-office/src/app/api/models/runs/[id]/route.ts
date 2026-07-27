import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { PROPERTY_SLOTS } from '@/lib/models/registry'

const PatchSchema = z.object({
  slot_id: z.string(),
  value: z.number(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid patch payload' }, { status: 400 })
  }

  // Closed world — silently reject edits to slot ids the registry doesn't know.
  if (!PROPERTY_SLOTS.some((s) => s.id === parsed.data.slot_id)) {
    return NextResponse.json({ error: 'Unknown slot id' }, { status: 400 })
  }

  const { data: run, error: fetchError } = await supabase
    .from('model_runs')
    .select('assumptions')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const assumptions = {
    ...(run.assumptions as Record<string, unknown>),
    [parsed.data.slot_id]: { value: parsed.data.value, origin: 'edited' },
  }

  const { error: updateError } = await supabase
    .from('model_runs')
    .update({ assumptions, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[models/runs/:id] update error:', updateError)
    return NextResponse.json({ error: 'Failed to update run' }, { status: 500 })
  }

  return NextResponse.json({ assumptions })
}
