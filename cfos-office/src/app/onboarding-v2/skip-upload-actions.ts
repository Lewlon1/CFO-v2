'use server'

import { createClient } from '@/lib/supabase/server'
import { advanceStep } from './actions-step'
import { trackFunnelEvent } from '@/lib/events/track-funnel-event'

/**
 * Skip the statement upload at the upload beat. Advances to the SAME step a
 * completed import would (`upload_processing`), so the user lands on the
 * existing income/rent form — just without an import running behind it. No
 * import_batches row is created; downstream "no import" behaviour keys off the
 * absence of transactions (see plan G1), so nothing else to persist here.
 */
export async function skipUploadToEssentials(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  await trackFunnelEvent(supabase, {
    profileId: user.id,
    eventType: 'upload_skipped',
    payload: {},
  })

  await advanceStep('upload_processing')
}
