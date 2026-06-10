'use server'

// VM-3 — skip path for the post-Read card session.
//
// Skipping is graceful by construction: nothing has been written yet (the
// session writes once, at completion), so "abandoning" means stamping the
// terminal onboarding step and arming the existing chat-offer columns so the
// CFO can offer the Value Map in conversation later. No rules, no re-score.

import { createClient } from '@/lib/supabase/server'
import { markOnboardingCompleteIfReady } from '@/lib/onboarding/markComplete'

export async function skipValueMapV2(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('user_profiles')
    .update({
      onboarding_step: 'complete',
      // Existing chat-offer column: the in-chat Value Map invite reads this.
      value_map_offered_in_chat: true,
    })
    .eq('id', user.id)
  if (error) {
    console.error('[value-map/v2] skip failed', error)
    throw new Error('Failed to skip Value Map')
  }

  await markOnboardingCompleteIfReady(supabase, user.id).catch((err) => {
    console.error('[value-map/v2] skip markComplete failed', err)
  })
}
