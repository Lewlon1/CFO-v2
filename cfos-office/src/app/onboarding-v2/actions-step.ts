'use server'

import { createClient } from '@/lib/supabase/server'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { transitionAndPersist } from '@/lib/onboarding-v2/state-machine'

export async function advanceStep(next: OnboardingStep): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  try {
    await transitionAndPersist(supabase, user.id, next)
  } catch (err) {
    console.error('[onboarding-v2] advanceStep failed', { next, err })
    throw err
  }
}
