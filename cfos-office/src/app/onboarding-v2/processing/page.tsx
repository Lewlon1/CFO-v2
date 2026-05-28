import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { ProcessingOrchestrator } from './processing-orchestrator'

export const dynamic = 'force-dynamic'

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
}

/**
 * Processing screen — hosts the income / rent form alongside the parse +
 * aggregate wait that the upload pipeline is finishing in the background.
 * Reached from upload-orchestrator.tsx once handleDone fires under the
 * layered-read flow. Resume routing brings users back here if they refresh
 * mid-form.
 */
export default async function OnboardingV2ProcessingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select(
      'entry_struggle, onboarding_step, net_monthly_income, monthly_rent, primary_currency',
    )
    .eq('id', user.id)
    .single()

  const step = (profile?.onboarding_step ?? null) as OnboardingStep | null
  const expected = resumeRoute(step, profile?.entry_struggle ?? null)
  if (expected !== '/onboarding-v2/processing') redirect(expected)

  const currencyCode = (profile?.primary_currency as string | null) ?? 'EUR'
  const currencySymbol = CURRENCY_SYMBOLS[currencyCode] ?? currencyCode

  return (
    <ProcessingOrchestrator
      initialIncome={profile?.net_monthly_income ?? null}
      initialRent={profile?.monthly_rent ?? null}
      currencySymbol={currencySymbol}
    />
  )
}
