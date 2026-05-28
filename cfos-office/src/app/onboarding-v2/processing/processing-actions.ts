'use server'

import { createClient } from '@/lib/supabase/server'
import { getPrimaryGoal } from '@/lib/goals/primary-goal'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { syncTotalFixedCosts } from '@/lib/analytics/monthly-snapshot'

export type InstantPayback =
  | { kind: 'goal_pace'; goal_name: string; monthly_required_saving: number; percent_of_income: number | null; currency: string }
  | { kind: 'no_goal' }
  | { kind: 'no_pace' }

/**
 * Persist the user's monthly take-home and return a one-line payback the
 * processing form renders inline on input blur. Pace is read from the
 * active goal's pre-computed monthly_required_saving (lib/goals/pace.ts) —
 * the form does not invoke the model, no arithmetic is performed in the
 * UI. percent_of_income is the only derived figure and uses the income
 * the user just submitted.
 */
export async function submitIncome(income: number): Promise<InstantPayback> {
  if (!Number.isFinite(income) || income <= 0) {
    throw new Error('Invalid income amount')
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('user_profiles')
    .update({ net_monthly_income: income })
    .eq('id', user.id)
  if (error) {
    console.error('[processing.submitIncome] update failed', error)
    throw new Error('Failed to save income')
  }

  const goal = await getPrimaryGoal(supabase, user.id)
  if (!goal) return { kind: 'no_goal' }
  if (goal.monthly_required_saving == null) return { kind: 'no_pace' }

  const profileRes = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .maybeSingle()
  const currency = (profileRes.data?.primary_currency as string | null) ?? 'EUR'

  const percent_of_income =
    income > 0 ? Math.round((goal.monthly_required_saving / income) * 100) : null

  return {
    kind: 'goal_pace',
    goal_name: goal.name,
    monthly_required_saving: goal.monthly_required_saving,
    percent_of_income,
    currency,
  }
}

/**
 * Persist the user's monthly rent. Returns nothing — the UI just advances.
 * Reconciliation against detected recurring runs at the confirm step (Phase 3).
 */
export async function submitRent(rent: number): Promise<void> {
  if (!Number.isFinite(rent) || rent < 0) {
    throw new Error('Invalid rent amount')
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('user_profiles')
    .update({ monthly_rent: rent })
    .eq('id', user.id)
  if (error) {
    console.error('[processing.submitRent] update failed', error)
    throw new Error('Failed to save rent')
  }
}

/**
 * Advance from the processing form to the confirm/reconcile screen. The
 * form-during-processing flow is the FIRST writer of total_fixed_costs for
 * this user — the upload-time refreshMonthlySnapshots ran before rent was
 * on file and before detectAndFlagRecurring had a chance to populate
 * recurring_expenses, so the total was 0/null at that point. Calling
 * syncTotalFixedCosts here closes the gap so the confirm screen's footer
 * total + the eventual First Read free-cash-flow figure are both correct.
 *
 * On failure we still advance — the Read can compose without
 * total_fixed_costs; the next upload will backfill.
 */
export async function advanceToConfirm(): Promise<{ redirectTo: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  await syncTotalFixedCosts(supabase, user.id).catch((err) => {
    console.error('[advanceToConfirm] syncTotalFixedCosts failed', err)
  })

  await advanceStep('details_pending' satisfies OnboardingStep)
  return { redirectTo: '/onboarding-v2/confirm' }
}
