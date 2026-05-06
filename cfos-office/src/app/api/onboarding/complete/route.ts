import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { seedFromOnboarding } from '@/lib/onboarding/profile-seeder'
import type { OnboardingData } from '@/lib/onboarding/types'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { capabilities, onboardingData } = await req.json() as {
    capabilities?: string[]
    onboardingData?: OnboardingData
  }

  // Mark onboarding as complete in user_profiles
  const { error } = await supabase
    .from('user_profiles')
    .update({
      onboarding_completed_at: new Date().toISOString(),
      onboarding_progress: null,
      ...(capabilities?.length ? { capability_preferences: capabilities } : {}),
    })
    .eq('id', user.id)

  if (error) {
    console.error('[onboarding] complete failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Seed progressive profiling data (best-effort, don't block response)
  if (onboardingData) {
    seedFromOnboarding(supabase, {
      userId: user.id,
      data: onboardingData,
    }).catch((err) => {
      console.error('[onboarding] profile seeding failed:', err)
    })
  }

  return NextResponse.json({ ok: true })
}
