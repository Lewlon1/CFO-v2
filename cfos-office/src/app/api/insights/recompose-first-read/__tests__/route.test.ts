import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the LLM compose, the cost guard (allowed by default — its own decision
// table lives in llm-guard.test.ts), and both Supabase client factories so the
// route runs against an inspectable stub. Everything else (the follow-up
// helpers, the claim's conditional-update semantics) runs for real.
const composeFirstRead = vi.fn()
vi.mock('@/lib/ai/compose-first-read', () => ({
  composeFirstRead: (...args: unknown[]) => composeFirstRead(...args),
}))
const checkLlmAllowed = vi.fn(async () => ({ allowed: true }))
vi.mock('@/lib/ai/llm-guard', () => ({
  checkLlmAllowed: (...args: unknown[]) => checkLlmAllowed(...args),
  LLM_LIMIT_MESSAGE: 'limit-copy',
}))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDb: any
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockDb }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => mockDb }))

import { POST } from '../route'

type Call = { table: string; method: string; value?: unknown; col?: string; val?: unknown; filter?: string }

/**
 * Chainable stub covering exactly the chains this route uses. The CLAIM
 * update is emulated: it matches (returns a row) only when the conversation's
 * metadata has recompose_in_progress not-true AND no recomposed stamp —
 * mirroring the route's `.or(...)` + `.is(...)` WHERE.
 */
function mockClient(meta: Record<string, unknown>) {
  const calls: Call[] = []
  const auth = { getUser: async () => ({ data: { user: { id: 'u1' } } }) }

  function chain(table: string) {
    let lastWrite: 'insert' | 'update' | null = null
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b,
      eq: (col: string, val: unknown) => {
        calls.push({ table, method: 'eq', col, val })
        return b
      },
      or: (filter: string) => {
        calls.push({ table, method: 'or', filter })
        return b
      },
      is: (col: string, val: unknown) => {
        calls.push({ table, method: 'is', col, val })
        return b
      },
      order: () => b,
      limit: () => b,
      insert: (value: unknown) => {
        calls.push({ table, method: 'insert', value })
        lastWrite = 'insert'
        return b
      },
      update: (value: unknown) => {
        calls.push({ table, method: 'update', value })
        lastWrite = 'update'
        return b
      },
      maybeSingle: async () => {
        if (lastWrite === 'insert') {
          lastWrite = null
          return { data: { id: 'm1' }, error: null }
        }
        if (lastWrite === 'update') {
          lastWrite = null
          // Emulate the claim WHERE against the conversation's metadata.
          const inProgress = String(meta.recompose_in_progress ?? '') === 'true'
          const stamped = meta.first_read_metadata_recomposed != null
          return inProgress || stamped
            ? { data: null, error: null } // zero rows matched — claim lost
            : { data: { id: 'conv1' }, error: null }
        }
        if (table === 'conversations') {
          return { data: { id: 'conv1', metadata: meta }, error: null }
        }
        return { data: { content: 'Prior read first sentence. More.' }, error: null }
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
    })
    return b
  }

  mockDb = { auth, from: vi.fn((table: string) => chain(table)), _calls: calls }
  return mockDb
}

const COMPOSED = {
  composedMessage: 'Delta read. — C.',
  metadata: { mode: 'value_first_recompose', layers_used: ['L1', 'L2'] },
}

beforeEach(() => {
  vi.clearAllMocks()
  composeFirstRead.mockReset()
  checkLlmAllowed.mockResolvedValue({ allowed: true })
})

describe('recompose-first-read idempotency', () => {
  it('already-recomposed stamp → benign 200 with conversationId, NO compose, NO claim', async () => {
    const client = mockClient({
      layered_read: true,
      first_read_metadata_recomposed: { layers_used: ['L1'] },
    })
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ conversationId: 'conv1', reason: 'already_recomposed' })
    expect(composeFirstRead).not.toHaveBeenCalled()
    expect(client._calls.filter((c: Call) => c.method === 'update')).toHaveLength(0)
  })

  it('claim lost (concurrent recompose in flight) → 409, NO compose', async () => {
    mockClient({ layered_read: true, recompose_in_progress: true })
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body).toMatchObject({ conversationId: 'conv1', reason: 'in_progress' })
    expect(composeFirstRead).not.toHaveBeenCalled()
  })

  it('clean conversation → claims, composes ONCE, appends ONCE, stamps + clears the claim in one write', async () => {
    composeFirstRead.mockResolvedValue(COMPOSED)
    const client = mockClient({ layered_read: true })
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ conversationId: 'conv1', message_persisted: true })
    expect(composeFirstRead).toHaveBeenCalledTimes(1)

    const inserts = client._calls.filter((c: Call) => c.table === 'messages' && c.method === 'insert')
    expect(inserts).toHaveLength(1)
    expect((inserts[0].value as Record<string, unknown>).content).toBe(COMPOSED.composedMessage)

    // Final metadata write carries the stamp AND clears the in-progress claim.
    const updates = client._calls
      .filter((c: Call) => c.table === 'conversations' && c.method === 'update')
      .map((c: Call) => c.value as Record<string, unknown>)
    const stamp = updates.find(
      (u) => (u.metadata as Record<string, unknown>)?.first_read_metadata_recomposed != null,
    )
    expect(stamp).toBeDefined()
    expect((stamp!.metadata as Record<string, unknown>).recompose_in_progress).toBe(false)
  })

  it('compose failure → claim cleared so a retry can succeed', async () => {
    composeFirstRead.mockRejectedValue(new Error('bedrock exploded'))
    const client = mockClient({ layered_read: true })
    const res = await POST()
    expect(res.status).toBe(500)
    // A standalone clear (recompose_in_progress: false, no stamp) ran.
    const updates = client._calls
      .filter((c: Call) => c.table === 'conversations' && c.method === 'update')
      .map((c: Call) => c.value as Record<string, unknown>)
    const clear = updates.find(
      (u) =>
        (u.metadata as Record<string, unknown>)?.recompose_in_progress === false &&
        (u.metadata as Record<string, unknown>)?.first_read_metadata_recomposed == null,
    )
    expect(clear).toBeDefined()
  })

  it('guard block → 429 with the limit body, nothing touched', async () => {
    checkLlmAllowed.mockResolvedValue({ allowed: false, reason: 'daily_cap' })
    const client = mockClient({ layered_read: true })
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(429)
    expect(body).toEqual({ error: 'limit', message: 'limit-copy' })
    expect(composeFirstRead).not.toHaveBeenCalled()
    expect(client._calls.filter((c: Call) => c.method === 'update')).toHaveLength(0)
  })
})
