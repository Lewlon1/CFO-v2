import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resumeRoute } from '@/lib/onboarding-v2/resume'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import {
  getHookCandidatesForUser,
  buildRealTransactionsFromHooks,
} from '@/lib/value-map/hook-transactions'
import { selectValueMapCards } from '@/lib/value-map/select-cards'
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
  // Track whether we've already persisted the card selection so the empty-seed
  // fallback below doesn't double-write the conversation metadata.
  let cardsPersisted = false
  const isValueFirstPath =
    hookParam || step === 'first_read_delivered' || step === 'value_map_offered'
  if (isValueFirstPath) {
    const hooks = await getHookCandidatesForUser(supabase, user.id)
    if (hooks && hooks.length > 0) {
      // Decoupled selection: the teased hooks become the SEED for a broader
      // (≤10) card set chosen by divergence + coverage + spread. merchant_
      // aggregates is service-role only, so use the service client here.
      try {
        const svc = createServiceClient()
        const selection = await selectValueMapCards(svc, user.id, hooks, currency)
        if (selection.cards.length > 0) {
          realTransactions = selection.cards
          // Persist what was actually put in front of the user so the recompose
          // (Phase 2) and the why-beat picker (Phase 3) can read the real set.
          await persistValueMapCards(supabase, user.id, selection)
          cardsPersisted = true
        }
      } catch (err) {
        console.error('[value-map.page] selectValueMapCards failed', err)
      }
      // Fallback: selector returned empty (or threw) → the original hook builder.
      if (realTransactions.length === 0) {
        realTransactions = await buildRealTransactionsFromHooks(
          supabase,
          user.id,
          hooks,
          currency,
        )
      }
    }
  }

  // Empty-seed fallback: users onboarded via the chat route get their first
  // read BEFORE uploading, so no hook_candidates ever land on the conversation.
  // The hooks path above then leaves realTransactions empty and the page falls
  // back to SAMPLE_TRANSACTIONS forever — even though the user has real
  // transactions. Re-run the SAME selector with an EMPTY hook seed: chooseCards
  // falls straight through to divergence/coverage over the real merchant_
  // aggregates (dropping non-outflow rows) and returns the real card set.
  //
  // Runs for both the value-first path AND post-read opt-in users, but only
  // when the hook path produced nothing. Only adopt the result when it clears 3
  // cards — a user with no meaningful outflows should still get the curated
  // SAMPLE_TRANSACTIONS arc (the orchestrator's legacy fallback).
  if ((postReadOptIn || isValueFirstPath) && realTransactions.length === 0) {
    try {
      const svc = createServiceClient()
      const selection = await selectValueMapCards(svc, user.id, [], currency)
      if (selection.cards.length >= 3) {
        realTransactions = selection.cards
        if (!cardsPersisted) {
          await persistValueMapCards(supabase, user.id, selection)
          cardsPersisted = true
        }
      }
    } catch (err) {
      console.error('[value-map.page] selectValueMapCards (empty seed) failed', err)
    }
  }

  if (isValueFirstPath) {
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

/**
 * Persist the Value Map card selection onto the active first_read conversation
 * metadata (`value_map_cards`), so the delta recompose and the why-beat picker
 * read what was actually sorted. Merge-update; non-fatal on failure. The user
 * owns the conversation row, so the user client's RLS permits the update.
 */
async function persistValueMapCards(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  selection: Awaited<ReturnType<typeof selectValueMapCards>>,
): Promise<void> {
  try {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, metadata')
      .eq('user_id', userId)
      .eq('type', 'first_read')
      .eq('metadata->>layered_read', 'true')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!conv?.id) return

    const keys = selection.cards
      .map((c) => c.merchant ?? c.description ?? '')
      .filter((s: string) => s.length > 0)
    const prev = (conv.metadata as Record<string, unknown> | null) ?? {}
    const newMeta = {
      ...prev,
      value_map_cards: {
        keys,
        selectionReason: selection.selectionReason,
        coveragePct: selection.coveragePct,
        includedHookMerchants: selection.includedHookMerchants,
      },
    }
    await supabase
      .from('conversations')
      .update({ metadata: newMeta })
      .eq('id', conv.id)
  } catch (err) {
    console.error('[value-map.page] persistValueMapCards failed', err)
  }
}
