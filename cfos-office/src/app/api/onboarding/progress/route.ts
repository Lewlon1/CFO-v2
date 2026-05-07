import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { OnboardingState } from '@/lib/onboarding/types'

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const progress: OnboardingState = await req.json()

  if (!progress || !progress.beat) {
    return NextResponse.json({ error: 'Invalid progress' }, { status: 400 })
  }

  // When resetting to the welcome beat with no completed beats, also clear
  // onboarding_completed_at so the modal will render again. This keeps the
  // debug/test path (reset-and-walk-through-flow) a single PATCH.
  const isFreshReset =
    progress.beat === 'welcome' &&
    (progress.completedBeats?.length ?? 0) === 0 &&
    !progress.completedAt &&
    !progress.skippedAt

  const updatePayload: Record<string, unknown> = { onboarding_progress: progress }
  if (isFreshReset) {
    updatePayload.onboarding_completed_at = null
    updatePayload.capability_preferences = null
  }

  const { error } = await supabase
    .from('user_profiles')
    .update(updatePayload)
    .eq('id', user.id)

  if (error) {
    console.error('[onboarding] progress update failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
