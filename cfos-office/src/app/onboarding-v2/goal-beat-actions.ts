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
 * Stamps onboarding_step='goal_set' for both routes. Does NOT stamp
 * onboarding_completed_at — completion is the Value Map's responsibility now,
 * so chat-path users finish onboarding via the VM, same as Marcus.
 *
 * For Marcus (entry_struggle = 'dont_know'): marks the goal-chat conversation
 * completed and returns the value-map URL so the watcher force-redirects there.
 *
 * For chat-path users: returns null so the watcher refreshes /office; the
 * <ACTION:start_value_map> CTA emitted in the goal-chat wrap-up message
 * carries the user into the Value Map at their pace.
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

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ onboarding_step: 'goal_set' satisfies OnboardingStep })
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
