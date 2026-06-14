import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reconcileFixedCosts } from '@/lib/analytics/reconcile-fixed-costs'
import { computeRecurringCandidates } from '@/lib/analytics/recurring-candidates'
import { assessCategoryCoverage } from '@/lib/analytics/category-coverage'

export const dynamic = 'force-dynamic'

/**
 * Payload for the in-sheet fixed-cost confirm beat. Mirrors what the old
 * /onboarding-v2/confirm server component computed inline — lifted here so the
 * confirm beat can run inside the chat sheet (deterministic onboarding host)
 * instead of on a dedicated page. Read-only: candidates + coverage are passes
 * around the strict reconcile; none of them write.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .maybeSingle()
  const currency = (profile?.primary_currency as string | null) ?? 'EUR'

  const [{ items, variableRecurring }, candidates, coverage] = await Promise.all([
    reconcileFixedCosts(supabase, user.id),
    computeRecurringCandidates(supabase, user.id),
    assessCategoryCoverage(supabase, user.id),
  ])

  return NextResponse.json({
    items,
    variable: variableRecurring,
    candidates,
    coverage,
    currency,
  })
}
