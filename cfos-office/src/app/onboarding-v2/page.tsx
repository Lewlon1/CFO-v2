import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { StruggleQuestion } from '@/components/onboarding-v2/struggle-question'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'

export const dynamic = 'force-dynamic'

export default async function OnboardingV2Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, display_name, onboarding_completed_at, onboarding_step')
    .eq('id', user.id)
    .single()

  if (profile?.onboarding_completed_at) {
    redirect('/office')
  }

  // Mid-onboarding users (entry_struggle set) get routed to where they left off.
  if (profile?.entry_struggle) {
    const step = (profile.onboarding_step ?? null) as OnboardingStep | null
    redirect(resumeRoute(step, profile.entry_struggle))
  }

  return (
    <StruggleQuestion
      userId={user.id}
      firstName={profile?.display_name ?? null}
    />
  )
}
