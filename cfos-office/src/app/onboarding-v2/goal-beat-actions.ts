'use server'

import { createClient } from '@/lib/supabase/server'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { trackFunnelEvent } from '@/lib/events/track-funnel-event'

export type CompleteGoalBeatResult = {
  redirectTo: string | null
  alreadyComplete: boolean
}

/**
 * Called by the GoalBeatWatcher in the office layout when polling detects
 * that a goal has been confirmed during the goal-derive-and-confirm beat,
 * OR the tentative-stall path has run its course. Value-first flow: the
 * beat is goal-only. Income and rent are collected later on the processing
 * screen.
 *
 * Idempotent — if the step has already moved past 'goal_chat_started',
 * returns alreadyComplete: true.
 *
 * Stamps onboarding_step='upload_processing' and routes the user to
 * /onboarding-v2/upload (the upload orchestrator then transitions to
 * /onboarding-v2/processing). Onboarding completion is stamped later, after
 * the first Read.
 *
 * Marks the goal-chat conversation as completed for all routes so it doesn't
 * re-open as the user moves on.
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
    .update({ onboarding_step: 'upload_pending' satisfies OnboardingStep })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[onboarding-v2.goal] completeGoalBeat update failed', updateErr)
    throw new Error('Failed to complete goal beat')
  }

  await trackFunnelEvent(supabase, {
    profileId: user.id,
    eventType: 'step_transition',
    payload: { from_step: currentStep, to_step: 'upload_pending', source: 'goal_beat_complete' },
  })

  return { redirectTo: '/onboarding-v2/upload', alreadyComplete: false }
}

/**
 * Called when the user opts out of setting a goal during the beat
 * ("Continue without setting a goal yet"). Value-first flow has no
 * bifurcation — the skip path routes to /onboarding-v2/upload like the
 * confirm path. The user will still get a First Read; the Value Map is
 * an opt-in chip afterwards.
 *
 * Stamps onboarding_step='upload_processing' so resume routing lines up
 * with completeGoalBeat. Closes the active goal-chat conversation so it
 * doesn't re-open as the user moves on.
 */
export async function skipGoalBeat(): Promise<{ redirectTo: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('onboarding_step')
    .eq('id', user.id)
    .maybeSingle()
  const fromStep = profile?.onboarding_step ?? null

  await supabase
    .from('conversations')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('type', 'onboarding_goal_chat')
    .eq('status', 'active')

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ onboarding_step: 'upload_pending' satisfies OnboardingStep })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[onboarding-v2.goal] skipGoalBeat update failed', updateErr)
    throw new Error('Failed to skip goal beat')
  }

  await trackFunnelEvent(supabase, {
    profileId: user.id,
    eventType: 'step_transition',
    payload: { from_step: fromStep, to_step: 'upload_pending', source: 'goal_beat_skip' },
  })

  return { redirectTo: '/onboarding-v2/upload' }
}
