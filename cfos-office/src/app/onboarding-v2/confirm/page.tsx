import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'

export const dynamic = 'force-dynamic'

/**
 * The fixed-cost confirm beat now runs inside the chat sheet (OnboardingBeatHost,
 * ConfirmBeatBlock — data from /api/onboarding-v2/confirm-data). This route is
 * retained only as a redirect so stale links / mid-flow refreshes resolve
 * correctly — resumeRoute sends in-sheet steps to /office.
 */
export default async function OnboardingV2ConfirmPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_step')
    .eq('id', user.id)
    .single()

  const step = (profile?.onboarding_step ?? null) as OnboardingStep | null
  redirect(resumeRoute(step, profile?.entry_struggle ?? null))
}
