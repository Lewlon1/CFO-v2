import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'

export const dynamic = 'force-dynamic'

/**
 * The statement-upload beat now runs inside the chat sheet (OnboardingBeatHost).
 * This route is retained only as a redirect so stale links / bookmarks / mid-flow
 * refreshes resolve to the right place — resumeRoute sends in-sheet steps to /office.
 */
export default async function OnboardingV2UploadPage() {
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
