import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { UploadOrchestrator } from './upload-orchestrator'

export const dynamic = 'force-dynamic'

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
  const expected = resumeRoute(step, profile?.entry_struggle ?? null)
  if (expected !== '/onboarding-v2/upload') redirect(expected)

  return <UploadOrchestrator />
}
