import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared recorders, hoisted so the vi.mock factories below can close over them.
const { order, trackCalls } = vi.hoisted(() => ({
  order: [] as string[],
  trackCalls: [] as Array<{ profileId: string; eventType: string; payload?: Record<string, unknown> }>,
}))

let mockUser: { id: string } | null = { id: 'u1' }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
  })),
}))

vi.mock('@/app/onboarding-v2/actions-step', () => ({
  advanceStep: vi.fn(async () => {
    order.push('advance')
  }),
}))

vi.mock('@/lib/events/track-funnel-event', () => ({
  trackFunnelEvent: vi.fn(async (_supabase: unknown, input: { profileId: string; eventType: string; payload?: Record<string, unknown> }) => {
    order.push('track')
    trackCalls.push(input)
  }),
}))

import { skipUploadToEssentials } from '../skip-upload-actions'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { trackFunnelEvent } from '@/lib/events/track-funnel-event'

beforeEach(() => {
  order.length = 0
  trackCalls.length = 0
  mockUser = { id: 'u1' }
  vi.clearAllMocks()
})

describe('skipUploadToEssentials', () => {
  it('emits upload_skipped with an empty payload', async () => {
    await skipUploadToEssentials()

    expect(trackFunnelEvent).toHaveBeenCalledTimes(1)
    expect(trackCalls[0]).toEqual({
      profileId: 'u1',
      eventType: 'upload_skipped',
      payload: {},
    })
  })

  it('emits upload_skipped BEFORE calling advanceStep("upload_processing")', async () => {
    await skipUploadToEssentials()

    expect(order).toEqual(['track', 'advance'])
    expect(advanceStep).toHaveBeenCalledWith('upload_processing')
  })

  it('throws when there is no authenticated user, and never tracks or advances', async () => {
    mockUser = null

    await expect(skipUploadToEssentials()).rejects.toThrow('Not authenticated')

    expect(trackFunnelEvent).not.toHaveBeenCalled()
    expect(advanceStep).not.toHaveBeenCalled()
  })
})
