// Persists the accepted first-insight experiment into active_experiments.
//
// The user taps "Yes, draft it for me" on the ExperimentCard at the
// first_insight beat and the OnboardingModal posts the (pre-v2) Experiment
// payload here. We map it onto the active_experiments columns and insert via
// the service client (the table's RLS only allows inserts from service_role).
//
// One active row per user is enforced by a unique partial index in
// migration 039 — a duplicate insert returns 409 so the modal can advance
// without leaving the user stuck.

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'
import type { Experiment } from '@/lib/analytics/insight-types'

export const dynamic = 'force-dynamic'

interface SaveExperimentRequest {
  experiment: Experiment
}

type ObservationType = 'high_freq_merchant' | 'category_variance' | 'time_pattern'

function observationTypeFor(kind: Experiment['template_kind']): ObservationType {
  switch (kind) {
    case 'subscription_audit':
      return 'time_pattern'
    case 'grocery_plan':
    case 'convenience_swap':
      return 'high_freq_merchant'
  }
}

function noticingTargetFor(kind: Experiment['template_kind']): string {
  switch (kind) {
    case 'grocery_plan':
      return 'shopping trip frequency'
    case 'subscription_audit':
      return 'active subscriptions'
    case 'convenience_swap':
      return 'small convenience purchases'
  }
}

// Next Sunday at 18:00 UTC, at least 1 day ahead of `now`. The Sunday
// callback engine isn't built yet (Session 27); this just satisfies the
// NOT NULL constraint with a sensible value.
function nextSundayAt(now: Date): Date {
  const d = new Date(now)
  const dow = d.getUTCDay()
  const daysUntilSun = (7 - dow) % 7 || 7
  d.setUTCDate(d.getUTCDate() + daysUntilSun)
  d.setUTCHours(18, 0, 0, 0)
  return d
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: SaveExperimentRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const e = body.experiment
  if (!e?.title || !e?.template_kind) {
    return NextResponse.json({ error: 'Invalid experiment payload' }, { status: 400 })
  }

  const service = createServiceClient()
  const now = new Date()

  const { data, error } = await service
    .from('active_experiments')
    .insert({
      user_id: user.id,
      conversation_id: null,
      observation_type: observationTypeFor(e.template_kind),
      pattern_template_key: e.template_kind,
      pattern_name: e.title,
      observation_payload: e as unknown as Record<string, unknown>,
      question: e.hypothesis,
      experiment_text: e.experiment_prompt,
      noticing_target: noticingTargetFor(e.template_kind),
      status: 'active',
      proposed_at: now.toISOString(),
      accepted_at: now.toISOString(),
      callback_due_at: nextSundayAt(now).toISOString(),
    })
    .select('id, pattern_name, pattern_template_key, status')
    .single()

  if (error) {
    // 23505 = unique_violation → user already has an active row.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Active experiment already exists for user' },
        { status: 409 },
      )
    }
    console.error('[save-experiment] DB insert failed:', error)
    return NextResponse.json({ error: 'Could not save experiment' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, experiment: data })
}
