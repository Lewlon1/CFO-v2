import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { trackFunnelEvent, trackOnboardingError } from '../track-funnel-event'

/**
 * Build a fake supabase client that records every payload passed to
 * `.from('user_events').insert(...)` and resolves with the configured
 * error (or throws, if `throwOnInsert` is set).
 */
function mockSupabase(opts: { error?: { message: string } | null; throwOnInsert?: unknown } = {}) {
  const inserts: Array<Record<string, unknown>> = []

  const userEventsChain = {
    insert: vi.fn(async (payload: Record<string, unknown>) => {
      inserts.push(payload)
      if (opts.throwOnInsert !== undefined) {
        throw opts.throwOnInsert
      }
      return { error: opts.error ?? null }
    }),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'user_events') return userEventsChain
      throw new Error(`Unexpected table: ${table}`)
    }),
    _inserts: inserts,
  }
}

describe('trackFunnelEvent', () => {
  it('inserts into user_events with the correct row shape', async () => {
    const supabase = mockSupabase()
    await trackFunnelEvent(supabase as unknown as SupabaseClient, {
      profileId: 'p1',
      eventType: 'step_viewed',
      payload: { step: 'income' },
      sessionId: 's1',
    })

    expect(supabase.from).toHaveBeenCalledWith('user_events')
    expect(supabase._inserts).toHaveLength(1)
    expect(supabase._inserts[0]).toEqual({
      profile_id: 'p1',
      event_type: 'step_viewed',
      event_category: 'funnel',
      payload: { step: 'income' },
      session_id: 's1',
    })
  })

  it('defaults event_category to "funnel" when category is omitted', async () => {
    const supabase = mockSupabase()
    await trackFunnelEvent(supabase as unknown as SupabaseClient, {
      profileId: 'p1',
      eventType: 'step_viewed',
    })
    expect(supabase._inserts[0].event_category).toBe('funnel')
  })

  it('honours an explicit category override', async () => {
    const supabase = mockSupabase()
    await trackFunnelEvent(supabase as unknown as SupabaseClient, {
      profileId: 'p1',
      eventType: 'session_started',
      category: 'session',
    })
    expect(supabase._inserts[0].event_category).toBe('session')
  })

  it('defaults payload to {} when omitted', async () => {
    const supabase = mockSupabase()
    await trackFunnelEvent(supabase as unknown as SupabaseClient, {
      profileId: 'p1',
      eventType: 'step_viewed',
    })
    expect(supabase._inserts[0].payload).toEqual({})
  })

  it('defaults session_id to null when omitted', async () => {
    const supabase = mockSupabase()
    await trackFunnelEvent(supabase as unknown as SupabaseClient, {
      profileId: 'p1',
      eventType: 'step_viewed',
    })
    expect(supabase._inserts[0].session_id).toBeNull()
  })

  it('resolves without throwing when the insert returns an error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = mockSupabase({ error: { message: 'RLS rejected' } })

    await expect(
      trackFunnelEvent(supabase as unknown as SupabaseClient, { profileId: 'p1', eventType: 'step_viewed' })
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    expect(consoleSpy.mock.calls[0][0]).toContain('[funnel-events]')

    consoleSpy.mockRestore()
  })

  it('resolves without throwing when the underlying insert call throws/rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = mockSupabase({ throwOnInsert: new Error('network down') })

    await expect(
      trackFunnelEvent(supabase as unknown as SupabaseClient, { profileId: 'p1', eventType: 'step_viewed' })
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    expect(consoleSpy.mock.calls[0][0]).toContain('[funnel-events]')

    consoleSpy.mockRestore()
  })
})

describe('trackOnboardingError', () => {
  it('inserts with category "system", event_type "onboarding_error", and a payload with surface + message', async () => {
    const supabase = mockSupabase()
    await trackOnboardingError(supabase as unknown as SupabaseClient, 'p1', 'declared-read-upgrade', new Error('boom'))

    expect(supabase._inserts).toHaveLength(1)
    const row = supabase._inserts[0]
    expect(row.event_category).toBe('system')
    expect(row.event_type).toBe('onboarding_error')
    expect(row.payload).toMatchObject({ surface: 'declared-read-upgrade', message: 'boom' })
  })

  it('includes any extra fields in the payload', async () => {
    const supabase = mockSupabase()
    await trackOnboardingError(supabase as unknown as SupabaseClient, 'p1', 'surface-x', new Error('boom'), {
      step: 'income',
    })
    expect(supabase._inserts[0].payload).toMatchObject({
      surface: 'surface-x',
      message: 'boom',
      step: 'income',
    })
  })

  it('truncates a very long error message to roughly 300 characters', async () => {
    const supabase = mockSupabase()
    const longMessage = 'x'.repeat(1000)
    await trackOnboardingError(supabase as unknown as SupabaseClient, 'p1', 'surface-x', new Error(longMessage))

    const payload = supabase._inserts[0].payload as Record<string, unknown>
    const message = payload.message as string
    expect(message.length).toBeLessThanOrEqual(320)
    expect(message.length).toBeGreaterThan(200)
  })

  it('normalises a non-Error string thrown value into a string message without throwing', async () => {
    const supabase = mockSupabase()
    await expect(
      trackOnboardingError(supabase as unknown as SupabaseClient, 'p1', 'surface-x', 'plain string error')
    ).resolves.toBeUndefined()
    expect(supabase._inserts[0].payload).toMatchObject({ message: 'plain string error' })
  })

  it('normalises a non-Error object thrown value into a string message without throwing', async () => {
    const supabase = mockSupabase()
    await expect(
      trackOnboardingError(supabase as unknown as SupabaseClient, 'p1', 'surface-x', { code: 'ECONNRESET' })
    ).resolves.toBeUndefined()
    const payload = supabase._inserts[0].payload as Record<string, unknown>
    expect(typeof payload.message).toBe('string')
    expect(payload.message).toBe(String({ code: 'ECONNRESET' }))
  })
})
