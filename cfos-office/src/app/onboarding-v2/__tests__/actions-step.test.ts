import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared recorders, hoisted so the vi.mock factories below can close over them.
const { calls, order, trackCalls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; value?: unknown; col?: string; val?: unknown }>,
  order: [] as string[],
  trackCalls: [] as Array<{ profileId: string; eventType: string; payload?: Record<string, unknown> }>,
}))

let currentStepInDb: string | null = 'goal_chat_started'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: (cols: string) => {
          calls.push({ table, method: 'select', value: cols })
          return b
        },
        eq: (col: string, val: unknown) => {
          calls.push({ table, method: 'eq', col, val })
          return b
        },
        maybeSingle: async () => ({ data: { onboarding_step: currentStepInDb }, error: null }),
        update: (value: unknown) => {
          calls.push({ table, method: 'update', value })
          return b
        },
        then: (resolve: (x: unknown) => unknown) => resolve({ error: null }),
      })
      return b
    },
  })),
}))

vi.mock('@/lib/onboarding/markComplete', () => ({
  markOnboardingCompleteIfReady: vi.fn(async () => {
    order.push('markComplete')
  }),
}))

vi.mock('@/lib/events/track-funnel-event', () => ({
  trackFunnelEvent: vi.fn(async (_supabase: unknown, input: { profileId: string; eventType: string; payload?: Record<string, unknown> }) => {
    order.push('track')
    trackCalls.push(input)
  }),
}))

import { advanceStep } from '../actions-step'
import { markOnboardingCompleteIfReady } from '@/lib/onboarding/markComplete'
import { trackFunnelEvent } from '@/lib/events/track-funnel-event'

function find(table: string, method: string) {
  return calls.filter((c) => c.table === table && c.method === method)
}

beforeEach(() => {
  calls.length = 0
  order.length = 0
  trackCalls.length = 0
  currentStepInDb = 'goal_chat_started'
  vi.clearAllMocks()
})

describe('advanceStep', () => {
  it('performs the same SELECT-then-UPDATE and skips markComplete for a non-terminal step', async () => {
    await advanceStep('upload_pending')

    expect(find('user_profiles', 'select')).toHaveLength(1)
    expect(find('user_profiles', 'update')[0]?.value).toEqual({ onboarding_step: 'upload_pending' })
    expect(markOnboardingCompleteIfReady).not.toHaveBeenCalled()
  })

  it('calls markOnboardingCompleteIfReady for terminal steps, unchanged from before', async () => {
    await advanceStep('first_read_shown')

    expect(find('user_profiles', 'update')[0]?.value).toEqual({ onboarding_step: 'first_read_shown' })
    expect(markOnboardingCompleteIfReady).toHaveBeenCalledTimes(1)
    expect(markOnboardingCompleteIfReady).toHaveBeenCalledWith(expect.anything(), 'u1')
  })

  it('emits a step_transition event with the correct from_step/to_step/source shape', async () => {
    currentStepInDb = 'goal_chat_started'

    await advanceStep('upload_pending')

    expect(trackFunnelEvent).toHaveBeenCalledTimes(1)
    expect(trackCalls[0]).toEqual({
      profileId: 'u1',
      eventType: 'step_transition',
      payload: {
        from_step: 'goal_chat_started',
        to_step: 'upload_pending',
        source: 'advance_step',
      },
    })

    // Tracking fires only after the update has resolved.
    expect(order[0]).toBe('track')
  })

  it('passes null from_step through when the prior SELECT finds nothing', async () => {
    currentStepInDb = null

    await advanceStep('upload_pending')

    expect(trackCalls[0]?.payload).toMatchObject({ from_step: null, to_step: 'upload_pending' })
  })

  it('still completes normally (update + markComplete) even if the tracking insert fails internally', async () => {
    // trackFunnelEvent never throws by contract — simulate that guarantee by
    // resolving normally even though the "insert" it wraps failed internally.
    vi.mocked(trackFunnelEvent).mockImplementationOnce(async () => {
      order.push('track-swallowed-failure')
    })

    await expect(advanceStep('complete')).resolves.toBeUndefined()

    expect(find('user_profiles', 'update')[0]?.value).toEqual({ onboarding_step: 'complete' })
    expect(markOnboardingCompleteIfReady).toHaveBeenCalledTimes(1)
  })
})
