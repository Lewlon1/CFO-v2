'use server'

import { createClient } from '@/lib/supabase/server'
import { CHAT_OPENERS } from '@/lib/onboarding-v2/openers'
import type { StruggleOptionId } from '@/lib/onboarding-v2/labels'

export type SubmitStruggleInput = {
  selectedOption: StruggleOptionId | null
  freeText: string | null
}

export type SubmitStruggleResult = {
  redirectTo: string
  // Client uses these to fire telemetry after the redirect resolves.
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

  // Marcus path skips straight into the Value Map — stamp value_map_started
  // in the same UPDATE so resume logic sees consistent state immediately.
  const isMarcus = route === 'value_map'
  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({
      entry_struggle: entryStruggle,
      entry_struggle_text: entryStruggleText,
      entry_struggle_at: new Date().toISOString(),
      onboarding_route: route,
      ...(isMarcus ? { onboarding_step: 'value_map_started' } : {}),
    })
    .eq('id', user.id)
  if (updateErr) {
    console.error('[onboarding-v2] entry_struggle update failed', updateErr)
    throw new Error('Failed to save entry struggle')
  }

  if (route === 'value_map') {
    return {
      redirectTo: '/onboarding-v2/value-map',
      route: 'value_map',
      entryStruggle,
      conversationId: null,
      freeTextLength: hasText ? trimmedText.length : null,
    }
  }

  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      title: 'New conversation',
      type: 'onboarding_v2_chat',
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

  if (entryStruggle === 'free_text') {
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: conv.id,
      user_id: user.id,
      role: 'user',
      content: trimmedText,
    })
    if (msgErr) {
      console.error('[onboarding-v2] user message insert failed', msgErr)
      throw new Error('Failed to save first message')
    }
    return {
      redirectTo: `/office?chat=open&conversationId=${conv.id}&fto=1`,
      route: 'chat',
      entryStruggle,
      conversationId: conv.id,
      freeTextLength: trimmedText.length,
    }
  }

  const opener =
    CHAT_OPENERS[entryStruggle as 'debt' | 'wealth' | 'planning']
  const { error: msgErr } = await supabase.from('messages').insert({
    conversation_id: conv.id,
    user_id: user.id,
    role: 'assistant',
    content: opener,
  })
  if (msgErr) {
    console.error('[onboarding-v2] opener message insert failed', msgErr)
    throw new Error('Failed to save opener message')
  }
  return {
    redirectTo: `/office?chat=open&conversationId=${conv.id}`,
    route: 'chat',
    entryStruggle,
    conversationId: conv.id,
    freeTextLength: null,
  }
}
