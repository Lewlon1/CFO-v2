'use server'

import { createClient } from '@/lib/supabase/server'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { syncTotalFixedCosts } from '@/lib/analytics/monthly-snapshot'
import { monthlyEquivalent } from '@/lib/analytics/recurring-detector'
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
  /**
   * Section-1 banked rows the user corrected (amount and/or cadence) and kept.
   * Persistence depends on where the row came from:
   *   - rent     → user_profiles.monthly_rent (cadence is locked to monthly in the UI)
   *   - declared → user_declared_fixed_costs updated in place (matched on label)
   *   - detected → the recurring_expenses row is dismissed and the corrected
   *     values become a confirmed declaration (source='banked_edit'). An
   *     in-place update would be clobbered by the next detector run, and an
   *     edit outside the ±10% reconcile band would otherwise double-count.
   */
  bankedEdits: Array<{
    label: string
    source: 'rent' | 'declared' | 'detected'
    amount: number
    cadence: Cadence
    bill_subtype: BillSubtype | null
  }>
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
 * Persist the confirm screen's decisions and refresh
 * monthly_snapshots.total_fixed_costs to match the new committed set.
 *
 * `mode` controls the terminal step:
 *   - 'onboarding' (default) — the value-first flow. Stamps `details_confirmed`
 *     (which fires the value-first first Read via OnboardingBeatHost's effect)
 *     and routes to the First Read.
 *   - 'check' — the OB-3 statement-check mission. The reconcile/persist (steps
 *     1–4) still runs because it verifies housing/bills against the real month,
 *     but it MUST NOT pass through `details_confirmed`: that step triggers the
 *     legacy value-first Read (POST /api/insights/post-upload). The check flow
 *     stays on `check_confirm_pending`; the host's onConfirmed fires the
 *     reality-check Read instead. (See OB-3-HANDOFF: the details_confirmed gotcha.)
 */
export async function confirmFixedCosts(
  payload: ConfirmPayload,
  opts: { mode?: 'onboarding' | 'check' } = {},
): Promise<{ redirectTo: string }> {
  const mode = opts.mode ?? 'onboarding'
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

  // 1c. Banked edits — user-corrected amount/cadence on rows already counted.
  const rentEdit = payload.bankedEdits.find((e) => e.source === 'rent')
  if (rentEdit) {
    await supabase
      .from('user_profiles')
      .update({ monthly_rent: monthlyEquivalent(rentEdit.amount, rentEdit.cadence) })
      .eq('id', user.id)
  }
  for (const e of payload.bankedEdits) {
    if (e.source !== 'declared') continue
    // Note: if the edit moves outside the ±10% band of a detected row this
    // declaration previously matched, that detected row resurfaces as its own
    // line on the next reconcile — correct, since the user's claim no longer
    // explains the detected cluster.
    await supabase
      .from('user_declared_fixed_costs')
      .update({ amount: e.amount, cadence: e.cadence })
      .eq('user_id', user.id)
      .eq('label', e.label)
      .neq('status', 'dismissed')
  }
  const detectedEdits = payload.bankedEdits.filter((e) => e.source === 'detected')
  if (detectedEdits.length > 0) {
    await supabase
      .from('recurring_expenses')
      .update({ status: 'dismissed' })
      .eq('user_id', user.id)
      .in('name', detectedEdits.map((e) => e.label))
  }

  // 2. Accepted candidates + captured gap/utility lines + corrected detected
  //    rows → confirmed declared costs.
  const declaredRows = [
    ...detectedEdits.map((e) => ({
      user_id: user.id,
      label: e.label,
      amount: e.amount,
      cadence: e.cadence,
      bill_subtype: e.bill_subtype,
      status: 'confirmed',
      source: 'banked_edit',
      currency,
    })),
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

  // 4. Recompute total against the new state. The advance differs by mode: the
  //    onboarding flow stamps details_confirmed (→ value-first Read); the check
  //    mission deliberately does NOT, so the host fires the reality-check Read.
  await syncTotalFixedCosts(supabase, user.id).catch((err) => {
    console.error('[confirmFixedCosts] syncTotalFixedCosts failed', err)
  })
  if (mode === 'check') {
    // Advance to check_confirm_done — NOT details_confirmed (that triggers the
    // legacy value-first Read). The distinct step makes the commit atomic with
    // the advance, so a refresh mid-compose resumes the (idempotent) reality-
    // check trigger rather than re-rendering the confirm beat and double-inserting.
    await advanceStep('check_confirm_done' satisfies OnboardingStep)
    return { redirectTo: '/office' }
  }
  await advanceStep('details_confirmed' satisfies OnboardingStep)
  return { redirectTo: '/onboarding-v2/first-read' }
}
