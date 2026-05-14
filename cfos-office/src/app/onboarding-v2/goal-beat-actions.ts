'use server'

import { createClient } from '@/lib/supabase/server'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'

export type CompleteGoalBeatResult = {
  redirectTo: string | null
  alreadyComplete: boolean
}

/**
 * Called by the GoalBeatWatcher in the office layout when polling detects a
 * new active goal during the goal-derive-and-confirm beat. Idempotent — if the
 * step has already moved past 'goal_chat_started', returns alreadyComplete: true.
 *
 * For Marcus (entry_struggle = 'dont_know') users: marks the goal-chat
 * conversation completed, stamps onboarding_step='goal_set', returns the
 * value-map URL so the watcher can route them onward.
 *
 * For chat-path users: stamps onboarding_step='complete' (they're done with
 * onboarding), returns null so the watcher leaves them in /office continuing
 * the same conversation.
 */
export async function completeGoalBeat(): Promise<CompleteGoalBeatResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_step, onboarding_completed_at')
    .eq('id', user.id)
    .single()

  const currentStep = profile?.onboarding_step as OnboardingStep | null

  // Already past this beat — nothing to do.
  if (currentStep && currentStep !== 'goal_chat_started') {
    return { redirectTo: null, alreadyComplete: true }
  }

  const isMarcus = profile?.entry_struggle === 'dont_know'

  if (isMarcus) {
    // Mark the goal-chat conversation completed so it doesn't re-open later.
    await supabase
      .from('conversations')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('type', 'onboarding_goal_chat')
      .eq('status', 'active')
  }

  const nextStep: OnboardingStep = isMarcus ? 'goal_set' : 'complete'
  const profileUpdate: Record<string, unknown> = { onboarding_step: nextStep }

  // Chat-path users have no further onboarding beats — stamp completion.
  if (!isMarcus && !profile?.onboarding_completed_at) {
    profileUpdate.onboarding_completed_at = new Date().toISOString()
  }

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update(profileUpdate)
    .eq('id', user.id)

  if (updateErr) {
    console.error('[onboarding-v2.goal] completeGoalBeat update failed', updateErr)
    throw new Error('Failed to complete goal beat')
  }

  return {
    redirectTo: isMarcus ? '/onboarding-v2/value-map' : null,
    alreadyComplete: false,
  }
}

/**
 * Called when the user opts out of setting a goal during the beat. Stamps
 * onboarding_step='goal_skipped' and returns the next destination per the
 * user's entry struggle. For chat-path users this also stamps
 * onboarding_completed_at since they have no further beats.
 */
export async function skipGoalBeat(): Promise<{ redirectTo: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_completed_at')
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

  const profileUpdate: Record<string, unknown> = {
    onboarding_step: 'goal_skipped' satisfies OnboardingStep,
  }
  if (!isMarcus && !profile?.onboarding_completed_at) {
    profileUpdate.onboarding_completed_at = new Date().toISOString()
  }

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update(profileUpdate)
    .eq('id', user.id)

  if (updateErr) {
    console.error('[onboarding-v2.goal] skipGoalBeat update failed', updateErr)
    throw new Error('Failed to skip goal beat')
  }

  return { redirectTo: isMarcus ? '/onboarding-v2/value-map' : null }
}
