'use server'

import { createClient } from '@/lib/supabase/server'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'

export type CompleteGoalBeatResult = {
  redirectTo: string | null
  alreadyComplete: boolean
}

/**
 * Called by the GoalBeatWatcher in the office layout when polling detects
 * that both essentials (net_monthly_income and monthly_rent) have landed
 * during the goal-derive-and-confirm beat. A goal is optional — the dont_know
 * pivot path collects essentials without a confirmed goal.
 *
 * Idempotent — if the step has already moved past 'goal_chat_started',
 * returns alreadyComplete: true.
 *
 * Stamps onboarding_step='essentials_done' and routes the user to
 * /onboarding-v2/upload. The Value Map is no longer a completion gate.
 * Completion is stamped after the first Read by markOnboardingCompleteIfReady.
 *
 * Marks the goal-chat conversation as completed for all routes so it doesn't
 * re-open as the user moves on to upload.
 */
export async function completeGoalBeat(): Promise<CompleteGoalBeatResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_step')
    .eq('id', user.id)
    .single()

  const currentStep = profile?.onboarding_step as OnboardingStep | null

  // Already past this beat — nothing to do. Accept both the primary beat
  // state and the tentative state the chat stall handler moves users into.
  const inBeat =
    currentStep === 'goal_chat_started' ||
    currentStep === 'goal_chat_tentative'
  if (currentStep && !inBeat) {
    return { redirectTo: null, alreadyComplete: true }
  }

  // Mark the goal-chat conversation completed so it doesn't re-open on
  // refresh once the user is on /onboarding-v2/upload.
  await supabase
    .from('conversations')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('type', 'onboarding_goal_chat')
    .eq('status', 'active')

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ onboarding_step: 'essentials_done' satisfies OnboardingStep })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[onboarding-v2.goal] completeGoalBeat update failed', updateErr)
    throw new Error('Failed to complete goal beat')
  }

  return { redirectTo: '/onboarding-v2/upload', alreadyComplete: false }
}

/**
 * Called when the user opts out of setting a goal during the beat. Stamps
 * onboarding_step='goal_skipped' for both routes and hands off to the Value
 * Map — completion is the Value Map's responsibility, so skipping the goal
 * does not stamp onboarding_completed_at.
 */
export async function skipGoalBeat(): Promise<{ redirectTo: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle')
    .eq('id', user.id)
    .single()

  const isMarcus = profile?.entry_struggle === 'dont_know'

  if (isMarcus) {
    await supabase
      .from('conversations')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('type', 'onboarding_goal_chat')
      .eq('status', 'active')
  }

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ onboarding_step: 'goal_skipped' satisfies OnboardingStep })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[onboarding-v2.goal] skipGoalBeat update failed', updateErr)
    throw new Error('Failed to skip goal beat')
  }

  return { redirectTo: '/onboarding-v2/value-map' }
}
