'use server'

import { createClient } from '@/lib/supabase/server'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { markOnboardingCompleteIfReady } from '@/lib/onboarding/markComplete'
import { trackFunnelEvent } from '@/lib/events/track-funnel-event'

export async function advanceStep(next: OnboardingStep): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: currentProfile } = await supabase
    .from('user_profiles')
    .select('onboarding_step')
    .eq('id', user.id)
    .maybeSingle()
  const fromStep = currentProfile?.onboarding_step ?? null

  const { error } = await supabase
    .from('user_profiles')
    .update({ onboarding_step: next })
    .eq('id', user.id)
  if (error) {
    console.error('[onboarding-v2] advanceStep failed', { next, error })
    throw new Error('Failed to advance onboarding step')
  }

  await trackFunnelEvent(supabase, {
    profileId: user.id,
    eventType: 'step_transition',
    payload: { from_step: fromStep, to_step: next, source: 'advance_step' },
  })

  // Reaching the first-read terminal state (or the explicit 'complete' state
  // on Continue) is the completion signal — the Value Map is no longer a
  // gate. `first_read_delivered` is the value-first flow's terminal name
  // for the same beat. The predicate is one-way so this is safe to call
  // unconditionally.
  if (
    next === 'first_read_shown' ||
    next === 'first_read_delivered' ||
    next === 'complete' ||
    next === 'archetype_shown'
  ) {
    await markOnboardingCompleteIfReady(supabase, user.id).catch((err) => {
      console.error('[onboarding-v2] advanceStep markComplete failed', err)
    })
  }
}
