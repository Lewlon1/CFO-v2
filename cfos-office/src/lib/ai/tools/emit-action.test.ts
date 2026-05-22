import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmitActionTool } from './emit-action'
import { IllegalTransitionError } from '@/lib/onboarding-v2/state-machine'

type ChainedQuery = ReturnType<typeof buildQueryStub>

function buildQueryStub(opts: {
  data?: unknown
  error?: unknown
} = {}) {
  const chain = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: opts.data ?? null, error: opts.error ?? null })),
    maybeSingle: vi.fn(async () => ({ data: opts.data ?? null, error: opts.error ?? null })),
  }
  return chain
}

function mockSupabase(stubs: Record<string, ChainedQuery>) {
  return {
    from: vi.fn((table: string) => {
      const stub = stubs[table]
      if (!stub) throw new Error(`Unexpected table query: ${table}`)
      return stub
    }),
  }
}

function makeCtx(supabase: unknown) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    userId: 'user-1',
    conversationId: 'conv-1',
    currency: 'GBP',
  }
}

describe('emit_action tool', () => {
  afterEach(() => vi.restoreAllMocks())

  it('start_value_map flips value_map_offered_in_chat and returns success', async () => {
    const profilesQuery = buildQueryStub()
    const supabase = mockSupabase({ user_profiles: profilesQuery })
    const tool = createEmitActionTool(makeCtx(supabase))

    const result = await tool.execute({ type: 'start_value_map' })

    expect(result).toMatchObject({ success: true, type: 'start_value_map' })
    expect(supabase.from).toHaveBeenCalledWith('user_profiles')
    expect(profilesQuery.update).toHaveBeenCalledWith({
      value_map_offered_in_chat: true,
    })
    expect(profilesQuery.eq).toHaveBeenCalledWith(
      'value_map_offered_in_chat',
      false,
    )
  })

  it('goal_set advances the state machine on a legal transition', async () => {
    const selectStub = buildQueryStub({ data: { onboarding_step: 'goal_chat_started' } })
    const updateStub = buildQueryStub()
    // user_profiles is queried twice — select then update. Return a stub that
    // alternates between the two roles.
    let nthCall = 0
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'user_profiles') throw new Error(`Unexpected table: ${table}`)
        nthCall += 1
        return nthCall === 1 ? selectStub : updateStub
      }),
    }
    const tool = createEmitActionTool(makeCtx(supabase))

    const result = await tool.execute({ type: 'goal_set' })

    expect(result).toMatchObject({ success: true, type: 'goal_set' })
    expect(updateStub.update).toHaveBeenCalledWith({ onboarding_step: 'goal_set' })
  })

  it('goal_set logs and continues on IllegalTransitionError', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Current step is 'complete' — terminal, so any transition is illegal.
    const selectStub = buildQueryStub({ data: { onboarding_step: 'complete' } })
    const updateStub = buildQueryStub()
    let nthCall = 0
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'user_profiles') throw new Error(`Unexpected table: ${table}`)
        nthCall += 1
        return nthCall === 1 ? selectStub : updateStub
      }),
    }
    const tool = createEmitActionTool(makeCtx(supabase))

    const result = await tool.execute({ type: 'goal_set' })

    expect(result).toMatchObject({ success: true, type: 'goal_set' })
    expect(updateStub.update).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
    const firstCallArgs = consoleSpy.mock.calls[0]
    expect(firstCallArgs[0]).toContain('emit_action:goal_set')
  })

  it('goal_skipped_now uses goal_skipped transition', async () => {
    const selectStub = buildQueryStub({ data: { onboarding_step: 'goal_chat_started' } })
    const updateStub = buildQueryStub()
    let nthCall = 0
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'user_profiles') throw new Error(`Unexpected table: ${table}`)
        nthCall += 1
        return nthCall === 1 ? selectStub : updateStub
      }),
    }
    const tool = createEmitActionTool(makeCtx(supabase))

    await tool.execute({ type: 'goal_skipped_now' })

    expect(updateStub.update).toHaveBeenCalledWith({
      onboarding_step: 'goal_skipped',
    })
  })

  it('upload_statement and open_folder return success without side effects', async () => {
    const supabase = { from: vi.fn() }
    const tool = createEmitActionTool(makeCtx(supabase))

    const upload = await tool.execute({ type: 'upload_statement' })
    const folder = await tool.execute({ type: 'open_folder', metadata: { key: 'goals' } })

    expect(upload).toMatchObject({ success: true, type: 'upload_statement' })
    expect(folder).toMatchObject({
      success: true,
      type: 'open_folder',
      metadata: { key: 'goals' },
    })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('IllegalTransitionError is constructed with from/to fields', () => {
    const err = new IllegalTransitionError('complete', 'goal_set')
    expect(err.from).toBe('complete')
    expect(err.to).toBe('goal_set')
    expect(err.message).toContain('complete')
    expect(err.message).toContain('goal_set')
  })
})
