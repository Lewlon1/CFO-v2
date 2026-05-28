import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { isLayeredReadEnabled } from '@/lib/feature-flags/layered-read'
import { FirstReadOrchestrator } from './first-read-orchestrator'

export const dynamic = 'force-dynamic'

/**
 * Session 32 (B) — terminal onboarding screen for users in the layered-read flow.
 *
 * Parallel to /onboarding-v2/archetype/page.tsx. Server component verifies the
 * user is in the right place (entry_struggle + onboarding_step gates) and the
 * flag is on, then renders the client orchestrator. The orchestrator triggers
 * the layered composition via POST /api/insights/post-upload and displays the
 * resulting first Read.
 */
export default async function OnboardingV2FirstReadPage() {
  // If the flag is off, this route shouldn't exist for the user — bounce them
  // to the archetype reveal (the unflagged terminal screen).
  if (!isLayeredReadEnabled()) {
    redirect('/onboarding-v2/archetype')
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_step, display_name')
    .eq('id', user.id)
    .single()

  const step = (profile?.onboarding_step ?? null) as OnboardingStep | null
  const expected = resumeRoute(step, profile?.entry_struggle ?? null)
  if (expected !== '/onboarding-v2/first-read') redirect(expected)

  // Value-first onboarding signal: the user arrived here via /processing →
  // /confirm, so their step is `details_confirmed` (about to flip to
  // `first_read_delivered`) or already `first_read_delivered` on refresh.
  const valueFirst =
    step === 'details_confirmed' || step === 'first_read_delivered'

  return (
    <FirstReadOrchestrator
      displayName={profile?.display_name ?? null}
      entryStruggle={profile?.entry_struggle ?? null}
      valueFirst={valueFirst}
    />
  )
}
