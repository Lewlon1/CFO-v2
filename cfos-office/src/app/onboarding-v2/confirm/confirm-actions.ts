'use server'

import { createClient } from '@/lib/supabase/server'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { syncTotalFixedCosts } from '@/lib/analytics/monthly-snapshot'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import type { Cadence } from '@/lib/analytics/reconcile-fixed-costs'
import type { BillSubtype } from '@/lib/analytics/benchmark/types'

/**
 * Everything the confirm screen collected, committed in one shot on "Continue".
 *
 * The screen builds this from local React state — nothing persists until the
 * user continues, matching the one-write contract. Accepted candidates and
 * captured gap/utility lines are USER DECLARATIONS, so they route through
 * user_declared_fixed_costs (status='confirmed') and ride the existing reconcile
 * + dedupe (a later detected match folds in, no double-count). Skips reuse the
 * 'dismissed' convention so they never resurface. No schema change required.
 */
export type ConfirmPayload = {
  /** Section-1 declared rows the user dropped → user_declared_fixed_costs dismissed (matched on label). */
  declaredDismissals: string[]
  /** Section-1 detected rows the user dropped → recurring_expenses dismissed (matched on name). */
  detectedDismissals: string[]
  /** "Worth a look" candidates the user counted → confirmed declared rows. */
  acceptedCandidates: Array<{
    name: string
    amount: number
    cadence: Cadence
    bill_subtype: BillSubtype | null
  }>
  /** "Worth a look" candidates the user skipped → dismissed recurring_expenses. */
  skippedCandidates: Array<{ name: string; amount: number; cadence: Cadence }>
  /** Captured utility / gap lines → confirmed declared rows. */
  declaredLines: Array<{
    label: string
    amount: number
    cadence: Cadence
    bill_subtype: BillSubtype | null
  }>
}

/**
 * Persist the confirm screen's decisions, refresh
 * monthly_snapshots.total_fixed_costs to match the new committed set, stamp
 * details_confirmed, and route to the First Read.
 */
export async function confirmFixedCosts(payload: ConfirmPayload): Promise<{ redirectTo: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: prof } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .single()
  const currency = (prof?.primary_currency as string | null) ?? 'EUR'

  // 1a. Detected drops → recurring_expenses dismissed (matched on name).
  if (payload.detectedDismissals.length > 0) {
    await supabase
      .from('recurring_expenses')
      .update({ status: 'dismissed' })
      .eq('user_id', user.id)
      .in('name', payload.detectedDismissals)
  }
  // 1b. Declared drops → user_declared_fixed_costs dismissed (matched on label).
  if (payload.declaredDismissals.length > 0) {
    await supabase
      .from('user_declared_fixed_costs')
      .update({ status: 'dismissed' })
      .eq('user_id', user.id)
      .in('label', payload.declaredDismissals)
  }

  // 2. Accepted candidates + captured gap/utility lines → confirmed declared costs.
  const declaredRows = [
    ...payload.acceptedCandidates.map((c) => ({
      user_id: user.id,
      label: c.name,
      amount: c.amount,
      cadence: c.cadence,
      bill_subtype: c.bill_subtype,
      status: 'confirmed',
      source: 'candidate_confirm',
      currency,
    })),
    ...payload.declaredLines.map((d) => ({
      user_id: user.id,
      label: d.label,
      amount: d.amount,
      cadence: d.cadence,
      bill_subtype: d.bill_subtype,
      status: 'confirmed',
      source: 'gap_capture',
      currency,
    })),
  ]
  if (declaredRows.length > 0) {
    await supabase.from('user_declared_fixed_costs').insert(declaredRows)
  }

  // 3. Skipped candidates → dismissed recurring_expenses so they never
  //    resurface (the detector skips dismissed names; the candidate pass
  //    treats any recurring_expenses name as already claimed).
  if (payload.skippedCandidates.length > 0) {
    await supabase.from('recurring_expenses').upsert(
      payload.skippedCandidates.map((c) => ({
        user_id: user.id,
        name: c.name,
        amount: c.amount,
        frequency: c.cadence,
        currency,
        status: 'dismissed',
      })),
      { onConflict: 'user_id,name', ignoreDuplicates: false },
    )
  }

  // 4. Recompute total against the new state, then advance + route to the Read.
  await syncTotalFixedCosts(supabase, user.id).catch((err) => {
    console.error('[confirmFixedCosts] syncTotalFixedCosts failed', err)
  })
  await advanceStep('details_confirmed' satisfies OnboardingStep)
  return { redirectTo: '/onboarding-v2/first-read' }
}
