// Persists a first-insight experiment as an action_item during onboarding so
// the user can accept it AND continue through the handoff beat instead of
// being routed straight into chat (which skipped the final onboarding screen).
//
// The in-chat equivalent is `create_action_item` tool (lib/ai/tools/create-action-item.ts).
// This endpoint exists because during onboarding we have no conversation_id,
// so we insert with conversation_id = null and a default 'spending_change'
// category (all three experiment templates — grocery_plan, subscription_audit,
// convenience_swap — are spending-change patterns).

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Experiment } from '@/lib/analytics/insight-types'

export const dynamic = 'force-dynamic'

interface SaveExperimentRequest {
  experiment: Experiment
}

function buildDescription(e: Experiment): string {
  const lines = [e.hypothesis, `Time: ${e.time_investment}`]
  const hasRange = e.annual_saving_low > 0 || e.annual_saving_high > 0
  if (hasRange) {
    const sym =
      e.currency === 'EUR' ? '\u20AC' :
      e.currency === 'GBP' ? '\u00A3' :
      e.currency === 'USD' ? '$' : `${e.currency} `
    const annual = e.annual_saving_low === e.annual_saving_high
      ? `${sym}${e.annual_saving_low.toLocaleString()}`
      : `${sym}${e.annual_saving_low.toLocaleString()}\u2013${sym}${e.annual_saving_high.toLocaleString()}`
    lines.push(`Estimated saving: ${annual}/year`)
  }
  return lines.join('\n')
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

  const { data, error } = await supabase
    .from('action_items')
    .insert({
      user_id: user.id,
      conversation_id: null,
      title: e.title,
      description: buildDescription(e),
      category: 'spending_change',
      priority: 'medium',
      status: 'pending',
    })
    .select('id, title, category, priority')
    .single()

  if (error) {
    console.error('[save-experiment] DB error:', error)
    return NextResponse.json({ error: 'Could not save action item' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, action_item: data })
}
