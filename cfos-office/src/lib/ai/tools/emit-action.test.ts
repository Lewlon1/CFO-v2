import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmitActionTool } from './emit-action'

type ChainedQuery = ReturnType<typeof buildQueryStub>

function buildQueryStub(opts: { data?: unknown; error?: unknown } = {}) {
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

  it('includes a metadata field (null when absent)', async () => {
    const supabase = { from: vi.fn() }
    const tool = createEmitActionTool(makeCtx(supabase))

    const result = (await tool.execute({ type: 'upload_statement' })) as {
      metadata: unknown
    }
    expect(result.metadata).toBeNull()
  })

  it('returns an error envelope when the side effect throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = {
      from: vi.fn(() => {
        throw new Error('boom')
      }),
    }
    const tool = createEmitActionTool(makeCtx(supabase))

    const result = await tool.execute({ type: 'start_value_map' })
    expect(result).toEqual({ error: 'Could not emit action.' })
    expect(consoleSpy).toHaveBeenCalled()
  })
})
