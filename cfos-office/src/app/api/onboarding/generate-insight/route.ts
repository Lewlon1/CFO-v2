import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeFirstInsight } from '@/lib/analytics/first-insight'

// ── Route handler ─────────────────────────────────────────────────────────────
//
// Returns a structured 3-card "wow moment" for the onboarding first_insight beat:
// Recurring subscriptions, biggest Leak, and value breakdown of actual spend.
// Queries are user-scoped (not batch-scoped), so multiple uploaded files all
// contribute to the insight.

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Body is optional now; import_batch_id is no longer required. Parse defensively.
  await req.json().catch(() => ({}))

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .single()

  const currency = profile?.primary_currency ?? 'GBP'

  const insightData = await computeFirstInsight(supabase, user.id, currency)

  return NextResponse.json({ insightData })
}
