import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { reconcileFixedCosts } from '@/lib/analytics/reconcile-fixed-costs'
import { computeRecurringCandidates } from '@/lib/analytics/recurring-candidates'
import { assessCategoryCoverage } from '@/lib/analytics/category-coverage'
import { ConfirmOrchestrator } from './confirm-orchestrator'

export const dynamic = 'force-dynamic'

/**
 * Confirm/reconcile screen — the user nods at the merged fixed-cost list
 * (declared form entries + auto-detected recurring, deduped on amount-band
 * and cadence) and the resulting total lands in
 * monthly_snapshots.total_fixed_costs. From here we head to the First Read.
 */
export default async function OnboardingV2ConfirmPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_step, primary_currency')
    .eq('id', user.id)
    .single()

  const step = (profile?.onboarding_step ?? null) as OnboardingStep | null
  const expected = resumeRoute(step, profile?.entry_struggle ?? null)
  if (expected !== '/onboarding-v2/confirm') redirect(expected)

  const currency = (profile?.primary_currency as string | null) ?? 'EUR'

  // Computed on the fly at confirm load. Candidates + coverage are read-only
  // passes around the strict reconcile; none write to recurring_expenses.
  const [{ items, variableRecurring }, candidates, coverage] = await Promise.all([
    reconcileFixedCosts(supabase, user.id),
    computeRecurringCandidates(supabase, user.id),
    assessCategoryCoverage(supabase, user.id),
  ])

  return (
    <ConfirmOrchestrator
      items={items}
      variable={variableRecurring}
      candidates={candidates}
      coverage={coverage}
      currency={currency}
    />
  )
}
