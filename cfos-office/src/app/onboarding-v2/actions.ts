'use server'

import { createClient } from '@/lib/supabase/server'
import type { StruggleOptionId } from '@/lib/onboarding-v2/labels'
import { transitionStep } from '@/lib/onboarding-v2/state-machine'
import { CONVERSATION_TYPES } from '@/lib/onboarding-v2/constants'

export type SubmitStruggleInput = {
  selectedOption: StruggleOptionId | null
  freeText: string | null
}

export type SubmitStruggleResult = {
  redirectTo: string
  // Client uses these to fire telemetry after the redirect resolves.
  // `route` reflects the *downstream* journey the user is on (Marcus
  // value-map vs chat-only) — it no longer tracks the immediate next page,
  // because every user now lands in /office for the goal-derive-and-confirm
  // beat regardless of struggle.
  route: 'value_map' | 'chat'
  entryStruggle: 'dont_know' | 'debt' | 'wealth' | 'planning' | 'free_text'
  conversationId: string | null
  freeTextLength: number | null
}

export async function submitStruggle(
  input: SubmitStruggleInput,
): Promise<SubmitStruggleResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const hasOption = input.selectedOption !== null
  const trimmedText = (input.freeText ?? '').trim()
  const hasText = trimmedText.length > 0
  if (hasOption === hasText) {
    throw new Error(
      'Pick an option or tell us in your own words — not both.',
    )
  }

  const entryStruggle: SubmitStruggleResult['entryStruggle'] = hasOption
    ? input.selectedOption!
    : 'free_text'

  const route: 'value_map' | 'chat' =
    entryStruggle === 'dont_know' ? 'value_map' : 'chat'
  const entryStruggleText = hasOption ? null : trimmedText

  // Validate via the state machine before writing — a struggle-submit on a
  // row that already has a non-null onboarding_step would mean we're skipping
  // backwards through the journey, which is a bug.
  const { data: existingProfile } = await supabase
    .from('user_profiles')
    .select('onboarding_step')
    .eq('id', user.id)
    .single()
  const nextStep = transitionStep(
    (existingProfile?.onboarding_step ?? null) as Parameters<typeof transitionStep>[0],
    'goal_chat_started',
  )

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({
      entry_struggle: entryStruggle,
      entry_struggle_text: entryStruggleText,
      entry_struggle_at: new Date().toISOString(),
      onboarding_route: route,
      onboarding_step: nextStep,
    })
    .eq('id', user.id)
  if (updateErr) {
    console.error('[onboarding-v2] entry_struggle update failed', updateErr)
    throw new Error('Failed to save entry struggle')
  }

  // Create the goal-derive-and-confirm conversation. The CFO opens it via
  // the auto-trigger registered for type='onboarding_goal_chat' in
  // ChatProvider, which fires when the conversation loads with no messages.
  // entry_struggle / entry_struggle_text live on user_profiles — context-builder
  // reads from there, so duplicating them into conversation metadata is dead.
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      title: 'Setting your first goal',
      type: CONVERSATION_TYPES.ONBOARDING_GOAL_CHAT,
      status: 'active',
    })
    .select('id')
    .single()
  if (convErr || !conv) {
    console.error('[onboarding-v2] conversation insert failed', convErr)
    throw new Error('Failed to create conversation')
  }

  return {
    redirectTo: `/office?chat=open&conversationId=${conv.id}`,
    route,
    entryStruggle,
    conversationId: conv.id,
    freeTextLength: hasText ? trimmedText.length : null,
  }
}
