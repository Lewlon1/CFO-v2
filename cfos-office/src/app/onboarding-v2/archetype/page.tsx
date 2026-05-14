import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { ArchetypeOrchestrator } from './archetype-orchestrator'
import type { OnboardingData } from '@/lib/onboarding/types'

export const dynamic = 'force-dynamic'

export default async function OnboardingV2ArchetypePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_step, display_name, primary_currency')
    .eq('id', user.id)
    .single()

  const step = (profile?.onboarding_step ?? null) as OnboardingStep | null
  const expected = resumeRoute(step, profile?.entry_struggle ?? null)
  if (expected !== '/onboarding-v2/archetype') redirect(expected)

  // Pull the most recent value_map_session + its per-card results to feed the
  // archetype generator the same way <OnboardingModal> does.
  const { data: session } = await supabase
    .from('value_map_sessions')
    .select('id, personality_type, dominant_quadrant, breakdown')
    .eq('profile_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let valueMapResults: OnboardingData['valueMapResults'] = []
  if (session?.id) {
    const { data: rows } = await supabase
      .from('value_map_results')
      .select(
        'transaction_id, quadrant, merchant, amount, confidence, first_tap_ms, card_time_ms, deliberation_ms, hard_to_decide',
      )
      .eq('session_id', session.id)
      .is('deleted_at', null)
    if (rows) {
      valueMapResults = rows.map((r) => ({
        transaction_id: String(r.transaction_id),
        quadrant: (r.quadrant as string | null) ?? null,
        merchant: String(r.merchant),
        amount: Number(r.amount),
        confidence: Number(r.confidence ?? 0),
        first_tap_ms: r.first_tap_ms ?? null,
        card_time_ms: Number(r.card_time_ms ?? 0),
        deliberation_ms: Number(r.deliberation_ms ?? 0),
        hard_to_decide: Boolean(r.hard_to_decide),
      }))
    }
  }

  const onboardingData: OnboardingData = {
    name: profile?.display_name ?? undefined,
    currency: profile?.primary_currency ?? 'GBP',
    personalityType: session?.personality_type ?? undefined,
    dominantQuadrant: session?.dominant_quadrant ?? undefined,
    breakdown:
      (session?.breakdown as OnboardingData['breakdown']) ?? undefined,
    valueMapResults,
  }

  return (
    <ArchetypeOrchestrator
      onboardingData={onboardingData}
      entryStruggle={profile?.entry_struggle ?? null}
    />
  )
}
