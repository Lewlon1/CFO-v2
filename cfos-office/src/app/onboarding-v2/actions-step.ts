'use server'

import { createClient } from '@/lib/supabase/server'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { markOnboardingCompleteIfReady } from '@/lib/onboarding/markComplete'

export async function advanceStep(next: OnboardingStep): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('user_profiles')
    .update({ onboarding_step: next })
    .eq('id', user.id)
  if (error) {
    console.error('[onboarding-v2] advanceStep failed', { next, error })
    throw new Error('Failed to advance onboarding step')
  }

  // Reaching the first-read terminal state (or the explicit 'complete' state
  // on Continue) is the new completion signal — the Value Map is no longer
  // a gate. The predicate is one-way so this is safe to call unconditionally.
  if (next === 'first_read_shown' || next === 'complete' || next === 'archetype_shown') {
    await markOnboardingCompleteIfReady(supabase, user.id).catch((err) => {
      console.error('[onboarding-v2] advanceStep markComplete failed', err)
    })
  }
}
