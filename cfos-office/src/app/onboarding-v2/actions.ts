'use server'

import { createClient } from '@/lib/supabase/server'
import type { StruggleOptionId } from '@/lib/onboarding-v2/labels'
import { trackFunnelEvent } from '@/lib/events/track-funnel-event'

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
      'Provide exactly one of selectedOption or non-empty freeText',
    )
  }

  const entryStruggle: SubmitStruggleResult['entryStruggle'] = hasOption
    ? input.selectedOption!
    : 'free_text'

  const route: 'value_map' | 'chat' =
    entryStruggle === 'dont_know' ? 'value_map' : 'chat'
  const entryStruggleText = hasOption ? null : trimmedText

  const { data: currentProfile } = await supabase
    .from('user_profiles')
    .select('onboarding_step')
    .eq('id', user.id)
    .maybeSingle()
  const fromStep = currentProfile?.onboarding_step ?? null

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({
      entry_struggle: entryStruggle,
      entry_struggle_text: entryStruggleText,
      entry_struggle_at: new Date().toISOString(),
      onboarding_route: route,
      onboarding_step: 'goal_chat_started',
    })
    .eq('id', user.id)
  if (updateErr) {
    console.error('[onboarding-v2] entry_struggle update failed', updateErr)
    throw new Error('Failed to save entry struggle')
  }

  await trackFunnelEvent(supabase, {
    profileId: user.id,
    eventType: 'struggle_submitted',
    payload: { entry_struggle: entryStruggle, route, free_text_length: hasText ? trimmedText.length : null },
  })
  await trackFunnelEvent(supabase, {
    profileId: user.id,
    eventType: 'step_transition',
    payload: { from_step: fromStep, to_step: 'goal_chat_started', source: 'submit_struggle' },
  })

  // Create the goal-derive-and-confirm conversation. The CFO opens it via
  // the auto-trigger registered for type='onboarding_goal_chat' in
  // ChatProvider, which fires when the conversation loads with no messages.
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      title: 'Setting your first goal',
      type: 'onboarding_goal_chat',
      status: 'active',
      metadata: {
        entry_struggle: entryStruggle,
        ...(entryStruggleText ? { entry_struggle_text: entryStruggleText } : {}),
      },
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
