import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'

export const dynamic = 'force-dynamic'

/**
 * The entry "what brought you in?" question is now folded into the chat sheet
 * (StruggleBeatBlock, rendered by the office layout when entry_struggle is
 * unset). This route is retained only as a redirect: brand-new users land in
 * /office for the in-sheet entry beat; mid-flow users resume where they left
 * off; completed users go to /office.
 */
export default async function OnboardingV2Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_completed_at, onboarding_step')
    .eq('id', user.id)
    .single()

  if (profile?.onboarding_completed_at) redirect('/office')

  // No entry struggle yet → the folded in-sheet entry beat lives in /office.
  if (!profile?.entry_struggle) redirect('/office')

  // Mid-onboarding — resume where they left off.
  const step = (profile.onboarding_step ?? null) as OnboardingStep | null
  redirect(resumeRoute(step, profile.entry_struggle))
}
