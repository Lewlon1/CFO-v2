import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_MESSAGE_LENGTH = 300

/**
 * Fire-and-forget funnel/system event tracking. Inserts a row into
 * `user_events` using the caller's (user-session) Supabase client so writes
 * go through RLS as the user, not a service client.
 *
 * Absolutely critical invariant: this NEVER throws. Every call site depends
 * on being able to `await trackFunnelEvent(...)` inline with no surrounding
 * try/catch — a tracking failure (network error, RLS rejection, whatever)
 * must never propagate to the caller. Errors are swallowed and logged.
 *
 * `event_category` has a CHECK constraint on the live table allowing:
 * explicit, behavioural, system, session, correction, engagement, upload,
 * funnel. This helper only ever writes 'funnel' | 'system' | 'session'.
 */
export async function trackFunnelEvent(
  supabase: SupabaseClient,
  input: {
    profileId: string
    eventType: string
    category?: 'funnel' | 'system' | 'session'
    payload?: Record<string, unknown>
    sessionId?: string | null
  }
): Promise<void> {
  try {
    const { error } = await supabase.from('user_events').insert({
      profile_id: input.profileId,
      event_type: input.eventType,
      event_category: input.category ?? 'funnel',
      payload: input.payload ?? {},
      session_id: input.sessionId ?? null,
    })
    if (error) {
      console.error('[funnel-events] insert failed:', error)
    }
  } catch (err) {
    console.error('[funnel-events] insert threw:', err)
  }
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) return message
  return message.slice(0, MAX_MESSAGE_LENGTH)
}

function normaliseError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Wraps trackFunnelEvent for onboarding error capture. Normalises whatever
 * was thrown (Error -> message, anything else -> String(err)) and truncates
 * the message so a runaway stack/payload doesn't bloat the events table.
 * Inherits the never-throws guarantee from trackFunnelEvent.
 */
export async function trackOnboardingError(
  supabase: SupabaseClient,
  profileId: string,
  surface: string,
  err: unknown,
  extra?: Record<string, unknown>
): Promise<void> {
  const message = truncateMessage(normaliseError(err))
  await trackFunnelEvent(supabase, {
    profileId,
    eventType: 'onboarding_error',
    category: 'system',
    payload: { surface, message, ...extra },
  })
}
