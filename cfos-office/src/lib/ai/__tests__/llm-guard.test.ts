import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the service client factory so recordChatTurnStart / completeChatTurn
// write against an inspectable stub instead of real Supabase.
const svcCalls: Array<{ table: string; method: string; value?: unknown }> = []
let svcInsertResult: { data: unknown; error: unknown } = { data: { id: 'log-1' }, error: null }
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      insert: (value: unknown) => {
        svcCalls.push({ table, method: 'insert', value })
        return {
          select: () => ({ single: async () => svcInsertResult }),
        }
      },
      update: (value: unknown) => {
        svcCalls.push({ table, method: 'update', value })
        return { eq: async () => ({ error: null }) }
      },
    }),
  }),
}))

import {
  checkLlmAllowed,
  recordChatTurnStart,
  completeChatTurn,
  LLM_SURFACE_LIMITS,
  LLM_LIMIT_MESSAGE,
} from '../llm-guard'

/**
 * Guard-facing Supabase stub: user_profiles block-flag read + llm_usage_log
 * daily count. `profileThrows` simulates an infrastructure failure (the guard
 * must fail open); `blockedAt` / `dailyCount` drive the decision table.
 */
function mockGuardClient(opts: {
  blockedAt?: string | null
  dailyCount?: number
  profileThrows?: boolean
  countError?: { message: string } | null
}) {
  return {
    from: (table: string) => {
      if (table === 'user_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (opts.profileThrows) throw new Error('db blip')
                return { data: { llm_blocked_at: opts.blockedAt ?? null }, error: null }
              },
            }),
          }),
        }
      }
      // llm_usage_log daily count: select(head/count) → eq → in → gte, awaited.
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              gte: async () => ({
                count: opts.dailyCount ?? 0,
                error: opts.countError ?? null,
              }),
            }),
          }),
        }),
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// The burst limiter is real and in-memory (module state persists across
// tests), so every test uses a unique userId to get a fresh bucket.
let userSeq = 0
function freshUserId(): string {
  userSeq += 1
  return `guard-test-user-${userSeq}`
}

beforeEach(() => {
  svcCalls.length = 0
  svcInsertResult = { data: { id: 'log-1' }, error: null }
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('checkLlmAllowed', () => {
  it('allows a clean user under all limits', async () => {
    const verdict = await checkLlmAllowed({
      userId: freshUserId(),
      surface: 'chat',
      supabase: mockGuardClient({ dailyCount: 0 }),
    })
    expect(verdict).toEqual({ allowed: true })
  })

  it('kill switch blocks everything, before any DB read', async () => {
    vi.stubEnv('LLM_DISABLED', '1')
    const throwingClient = {
      from: () => {
        throw new Error('must not be called')
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const verdict = await checkLlmAllowed({
      userId: freshUserId(),
      surface: 'chat',
      supabase: throwingClient,
    })
    expect(verdict).toEqual({ allowed: false, reason: 'disabled' })
  })

  it('a set llm_blocked_at blocks the user', async () => {
    const verdict = await checkLlmAllowed({
      userId: freshUserId(),
      surface: 'chat',
      supabase: mockGuardClient({ blockedAt: '2026-07-03T09:00:00Z' }),
    })
    expect(verdict).toEqual({ allowed: false, reason: 'blocked' })
  })

  it('the durable daily cap blocks at the configured ceiling', async () => {
    const cap = LLM_SURFACE_LIMITS.chat.dailyCap
    const verdict = await checkLlmAllowed({
      userId: freshUserId(),
      surface: 'chat',
      supabase: mockGuardClient({ dailyCount: cap }),
    })
    expect(verdict).toEqual({ allowed: false, reason: 'daily_cap' })
  })

  it('one under the daily cap still passes', async () => {
    const cap = LLM_SURFACE_LIMITS.chat.dailyCap
    const verdict = await checkLlmAllowed({
      userId: freshUserId(),
      surface: 'chat',
      supabase: mockGuardClient({ dailyCount: cap - 1 }),
    })
    expect(verdict).toEqual({ allowed: true })
  })

  it('the burst limit trips after the configured per-minute count', async () => {
    const userId = freshUserId()
    const client = mockGuardClient({ dailyCount: 0 })
    const { burstLimit } = LLM_SURFACE_LIMITS.chat
    for (let i = 0; i < burstLimit; i++) {
      const v = await checkLlmAllowed({ userId, surface: 'chat', supabase: client })
      expect(v.allowed).toBe(true)
    }
    const blocked = await checkLlmAllowed({ userId, surface: 'chat', supabase: client })
    expect(blocked).toEqual({ allowed: false, reason: 'burst' })
  })

  it('fails OPEN on infrastructure errors — a DB blip must not take chat down', async () => {
    const throwing = await checkLlmAllowed({
      userId: freshUserId(),
      surface: 'chat',
      supabase: mockGuardClient({ profileThrows: true, dailyCount: 0 }),
    })
    expect(throwing).toEqual({ allowed: true })

    const countErr = await checkLlmAllowed({
      userId: freshUserId(),
      surface: 'chat',
      supabase: mockGuardClient({ countError: { message: 'boom' } }),
    })
    expect(countErr).toEqual({ allowed: true })
  })

  it('surfaces are isolated: a chat burst does not block another surface', async () => {
    const userId = freshUserId()
    const client = mockGuardClient({ dailyCount: 0 })
    for (let i = 0; i < LLM_SURFACE_LIMITS.chat.burstLimit + 1; i++) {
      await checkLlmAllowed({ userId, surface: 'chat', supabase: client })
    }
    const other = await checkLlmAllowed({
      userId,
      surface: 'first_read_compose',
      supabase: client,
    })
    expect(other).toEqual({ allowed: true })
  })

  it('the friendly-block copy exists and reads like C., not an error code', () => {
    expect(LLM_LIMIT_MESSAGE.length).toBeGreaterThan(10)
    expect(LLM_LIMIT_MESSAGE).not.toMatch(/limit|quota|rate|429/i)
  })
})

describe('recordChatTurnStart / completeChatTurn', () => {
  it('inserts the accounting row with call_type chat_turn and returns its id', async () => {
    const id = await recordChatTurnStart({
      userId: 'u1',
      conversationId: 'c1',
      model: 'claude-sonnet-4-6',
    })
    expect(id).toBe('log-1')
    expect(svcCalls).toHaveLength(1)
    const insert = svcCalls[0]
    expect(insert.table).toBe('llm_usage_log')
    expect(insert.value).toMatchObject({
      user_id: 'u1',
      call_type: 'chat_turn',
      model: 'claude-sonnet-4-6',
      metadata: { conversation_id: 'c1' },
    })
  })

  it('returns null on insert failure — accounting must never block the turn', async () => {
    svcInsertResult = { data: null, error: { message: 'rls says no' } }
    const id = await recordChatTurnStart({ userId: 'u1', conversationId: 'c1', model: 'm' })
    expect(id).toBeNull()
  })

  it('completeChatTurn backfills tokens; a null rowId is a silent no-op', async () => {
    await completeChatTurn({ rowId: null, inputTokens: 10, outputTokens: 5 })
    expect(svcCalls).toHaveLength(0)

    await completeChatTurn({ rowId: 'log-1', inputTokens: 100, outputTokens: 40, durationMs: 1234 })
    expect(svcCalls).toHaveLength(1)
    expect(svcCalls[0].method).toBe('update')
    expect(svcCalls[0].value).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      duration_ms: 1234,
    })
  })
})
