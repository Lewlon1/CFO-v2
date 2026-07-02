import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PROPERTY_DECISION } from '@/lib/models/registry'

const OPENING_MESSAGE =
  "Let's model the property: keep it and rent it out, sell and index the proceeds, or sell and sit in cash. A handful of questions, then the engine runs. First — what's it worth today? A recent valuation or your best estimate is fine."

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_financial_profile')
    .select('default_horizon_years')
    .eq('user_id', user.id)
    .maybeSingle()

  // Interview opens by confirming stale profile values, not re-asking — seed
  // horizon_years at 'profile' tier if a profile row already exists.
  const assumptions = profile?.default_horizon_years
    ? { horizon_years: { value: profile.default_horizon_years, origin: 'profile' } }
    : {}

  const openingText = profile?.default_horizon_years
    ? `${OPENING_MESSAGE} (I've got your usual ${profile.default_horizon_years}-year horizon — shout if that's changed.)`
    : OPENING_MESSAGE

  const { data: run, error } = await supabase
    .from('model_runs')
    .insert({
      user_id: user.id,
      decision_type: PROPERTY_DECISION.id,
      schema_version: PROPERTY_DECISION.schemaVersion,
      defaults_version: PROPERTY_DECISION.defaultsVersion,
      status: 'interviewing',
      assumptions,
      messages: [{ role: 'assistant', text: openingText }],
      caveats: [],
    })
    .select('id')
    .single()

  if (error || !run) {
    console.error('[models/runs] insert error:', error)
    return NextResponse.json({ error: 'Failed to create model run' }, { status: 500 })
  }

  return NextResponse.json({ id: run.id })
}
