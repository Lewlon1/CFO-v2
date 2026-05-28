'use server'

import { createClient } from '@/lib/supabase/server'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { syncTotalFixedCosts } from '@/lib/analytics/monthly-snapshot'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import type { Cadence } from '@/lib/analytics/reconcile-fixed-costs'

type ConfirmedRow = {
  label: string
  amount: number
  cadence: Cadence
  source: 'rent' | 'declared' | 'detected'
  decision: 'confirm' | 'dismiss'
}

/**
 * Persist the user's per-row decisions from the confirm screen, refresh
 * monthly_snapshots.total_fixed_costs to match the confirmed set, stamp
 * details_confirmed, and route to the First Read.
 *
 * The user has only acted on items the reconcile helper surfaced — declared
 * superseded duplicates were filtered before render. Dismissed declared
 * rows get status='dismissed' so they don't resurface on a future reload.
 * Detected items marked dismissed get status='dismissed' on
 * recurring_expenses (matching the existing detector convention).
 */
export async function confirmFixedCosts(
  rows: ConfirmedRow[],
): Promise<{ redirectTo: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Apply dismissals: declared rows are matched on label; detected rows on
  // name. The reconcile helper's outputs are derived from the same source
  // rows so the label / name strings are stable for the lookup.
  const declaredDismissals = rows.filter(
    (r) => r.source === 'declared' && r.decision === 'dismiss',
  )
  const detectedDismissals = rows.filter(
    (r) => r.source === 'detected' && r.decision === 'dismiss',
  )

  if (declaredDismissals.length > 0) {
    const labels = declaredDismissals.map((r) => r.label)
    await supabase
      .from('user_declared_fixed_costs')
      .update({ status: 'dismissed' })
      .eq('user_id', user.id)
      .in('label', labels)
  }
  if (detectedDismissals.length > 0) {
    const names = detectedDismissals.map((r) => r.label)
    await supabase
      .from('recurring_expenses')
      .update({ status: 'dismissed' })
      .eq('user_id', user.id)
      .in('name', names)
  }

  // Refresh total_fixed_costs against the post-dismissal state.
  await syncTotalFixedCosts(supabase, user.id).catch((err) => {
    console.error('[confirmFixedCosts] syncTotalFixedCosts failed', err)
  })

  await advanceStep('details_confirmed' satisfies OnboardingStep)
  return { redirectTo: '/onboarding-v2/first-read' }
}
