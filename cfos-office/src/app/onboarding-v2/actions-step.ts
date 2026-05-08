'use server'

import { createClient } from '@/lib/supabase/server'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'

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
}
