import { describe, expect, it, vi } from 'vitest'
import { markOnboardingCompleteIfReady } from './markComplete'

type ProfileRow = {
  id: string
  onboarding_completed_at: string | null
  anonymised_at: string | null
  onboarding_step: string | null
}

/**
 * Build a fake supabase client that returns:
 *   - the supplied profile row when reading user_profiles by id
 *   - the supplied value_map_sessions count
 *   - records the UPDATE payload that lands on user_profiles
 */
function mockSupabase(opts: {
  profile: ProfileRow | null
  vmSessionCount: number
}) {
  const updates: Array<Record<string, unknown>> = []
  const eventInserts: Array<Record<string, unknown>> = []

  const userProfilesChain = {
    select: vi.fn((cols: string) => ({
      eq: vi.fn(() => ({
        maybeSingle: async () => ({ data: opts.profile, error: null }),
      })),
      ...(cols.includes('count') ? {} : {}),
    })),
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload)
      const chain = {
        eq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        select: vi.fn(() => ({
          then: (resolve: (v: { data: Array<{ id: string }>; error: null }) => unknown) =>
            resolve({ data: [{ id: opts.profile?.id ?? 'u1' }], error: null }),
        })),
        then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
      }
      return chain
    }),
  }

  const vmSessionsChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        limit: vi.fn(async () => ({ count: opts.vmSessionCount, error: null })),
      })),
    })),
  }

  const userEventsChain = {
    insert: vi.fn(async (payload: Record<string, unknown>) => {
      eventInserts.push(payload)
      return { error: null }
    }),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'user_profiles') return userProfilesChain
      if (table === 'value_map_sessions') return vmSessionsChain
      if (table === 'user_events') return userEventsChain
      throw new Error(`Unexpected table: ${table}`)
    }),
    _updates: updates,
    _eventInserts: eventInserts,
  }
}

describe('markOnboardingCompleteIfReady', () => {
  it('stamps completion when onboarding_step is first_read_shown (no VM required)', async () => {
    const supabase = mockSupabase({
      profile: {
        id: 'u1',
        onboarding_completed_at: null,
        anonymised_at: null,
        onboarding_step: 'first_read_shown',
      },
      vmSessionCount: 0,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markOnboardingCompleteIfReady(supabase as any, 'u1')
    expect(supabase._updates).toHaveLength(1)
    expect(supabase._updates[0]).toHaveProperty('onboarding_completed_at')
    expect(supabase._eventInserts).toHaveLength(1)
    expect(supabase._eventInserts[0]).toMatchObject({
      event_type: 'onboarding_completed',
      payload: { trigger_step: 'first_read_shown' },
    })
  })

  it('stamps completion when a value_map_sessions row exists even without read step', async () => {
    const supabase = mockSupabase({
      profile: {
        id: 'u1',
        onboarding_completed_at: null,
        anonymised_at: null,
        onboarding_step: 'value_map_done',
      },
      vmSessionCount: 1,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markOnboardingCompleteIfReady(supabase as any, 'u1')
    expect(supabase._updates).toHaveLength(1)
    expect(supabase._eventInserts).toHaveLength(1)
    expect(supabase._eventInserts[0]).toMatchObject({
      event_type: 'onboarding_completed',
      payload: { trigger_step: 'value_map_done' },
    })
  })

  it('does NOT stamp completion when neither read step nor VM session', async () => {
    const supabase = mockSupabase({
      profile: {
        id: 'u1',
        onboarding_completed_at: null,
        anonymised_at: null,
        onboarding_step: 'essentials_done',
      },
      vmSessionCount: 0,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markOnboardingCompleteIfReady(supabase as any, 'u1')
    expect(supabase._updates).toHaveLength(0)
    expect(supabase._eventInserts).toHaveLength(0)
  })

  it('is a no-op when already completed', async () => {
    const supabase = mockSupabase({
      profile: {
        id: 'u1',
        onboarding_completed_at: '2026-01-01T00:00:00Z',
        anonymised_at: null,
        onboarding_step: 'first_read_shown',
      },
      vmSessionCount: 0,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markOnboardingCompleteIfReady(supabase as any, 'u1')
    expect(supabase._updates).toHaveLength(0)
    expect(supabase._eventInserts).toHaveLength(0)
  })

  it('is a no-op when user is anonymised', async () => {
    const supabase = mockSupabase({
      profile: {
        id: 'u1',
        onboarding_completed_at: null,
        anonymised_at: '2026-01-01T00:00:00Z',
        onboarding_step: 'first_read_shown',
      },
      vmSessionCount: 1,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markOnboardingCompleteIfReady(supabase as any, 'u1')
    expect(supabase._updates).toHaveLength(0)
    expect(supabase._eventInserts).toHaveLength(0)
  })

  it('stamps completion when step is "complete" (e.g. set by advanceStep on Continue)', async () => {
    const supabase = mockSupabase({
      profile: {
        id: 'u1',
        onboarding_completed_at: null,
        anonymised_at: null,
        onboarding_step: 'complete',
      },
      vmSessionCount: 0,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markOnboardingCompleteIfReady(supabase as any, 'u1')
    expect(supabase._updates).toHaveLength(1)
    expect(supabase._eventInserts).toHaveLength(1)
    expect(supabase._eventInserts[0]).toMatchObject({
      event_type: 'onboarding_completed',
      payload: { trigger_step: 'complete' },
    })
  })
})
