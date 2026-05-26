import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { isLayeredReadEnabled } from '@/lib/feature-flags/layered-read'
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

  // Session 32 (B) — pass the feature flag as a prop so the client-side
  // upload orchestrator can pick the right post-upload destination without
  // needing process.env access at runtime (env vars are server-only in
  // Next.js unless prefixed NEXT_PUBLIC_, which we deliberately avoid here).
  return <UploadOrchestrator layered={isLayeredReadEnabled()} />
}
