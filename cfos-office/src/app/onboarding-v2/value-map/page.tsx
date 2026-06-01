import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import {
  getHookCandidatesForUser,
  buildRealTransactionsFromHooks,
} from '@/lib/value-map/hook-transactions'
import type { ValueMapTransaction } from '@/lib/value-map/types'
import { ValueMapOrchestrator } from './value-map-orchestrator'

export const dynamic = 'force-dynamic'

export default async function OnboardingV2ValueMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_step, primary_currency')
    .eq('id', user.id)
    .single()

  const step = (profile?.onboarding_step ?? null) as OnboardingStep | null

  // Post-read opt-in: users who have already reached the first-read terminal
  // state (or completed onboarding) can take the Value Map as a deepening
  // move. Don't bounce them back to resume. Value-first flow also reaches
  // here via the hook CTA on /first-read — same opt-in semantics.
  const postReadOptIn =
    step === 'first_read_shown' ||
    step === 'first_read_delivered' ||
    step === 'value_map_offered' ||
    step === 'archetype_shown' ||
    step === 'complete'

  // ?hook=1 is passed by the first-read CTA when valueFirst=true. The step
  // advance (first_read_delivered) is fire-and-forget so it may not have
  // committed by the time the server renders this page — treat the param as
  // an authoritative signal so real transactions load even if the DB step
  // is still catching up.
  const params = await searchParams
  const hookParam = params.hook === '1'

  if (!postReadOptIn && !hookParam) {
    const expected = resumeRoute(step, profile?.entry_struggle ?? null)
    if (expected !== '/onboarding-v2/value-map') redirect(expected)
  }

  const currency = (profile?.primary_currency as string | null) ?? 'GBP'

  // Value-first flow: load the hook candidates the First Read just named
  // and turn them into real transaction cards so the user maps the EXACT
  // items the CFO said it couldn't read alone. Empty → fall back to
  // SAMPLE_TRANSACTIONS (legacy path / no-hooks-on-file resilience).
  let realTransactions: ValueMapTransaction[] = []
  const isValueFirstPath =
    hookParam || step === 'first_read_delivered' || step === 'value_map_offered'
  if (isValueFirstPath) {
    const hooks = await getHookCandidatesForUser(supabase, user.id)
    if (hooks && hooks.length > 0) {
      realTransactions = await buildRealTransactionsFromHooks(
        supabase,
        user.id,
        hooks,
        currency,
      )
    }
    // Stamp value_map_offered so a refresh keeps the user here instead of
    // bouncing to /first-read.
    //
    // hookParam race: the first_read_delivered advance is fire-and-forget in
    // the orchestrator, so the step might still be details_confirmed when this
    // page renders. Stamp first_read_delivered first (so markComplete can
    // fire), then value_map_offered. Both advanceStep calls are no-ops if the
    // step is already at or past the target.
    const terminalSteps = new Set(['value_map_offered', 'archetype_shown', 'complete'])
    if (!terminalSteps.has(step ?? '')) {
      if (step !== 'first_read_delivered') {
        await advanceStep('first_read_delivered').catch((err) => {
          console.error('[value-map.page] advanceStep(first_read_delivered) failed', err)
        })
      }
      await advanceStep('value_map_offered').catch((err) => {
        console.error('[value-map.page] advanceStep(value_map_offered) failed', err)
      })
    }
  }

  return (
    <ValueMapOrchestrator
      currency={currency}
      postReadOptIn={postReadOptIn}
      realTransactions={realTransactions}
      valueFirst={isValueFirstPath}
    />
  )
}
