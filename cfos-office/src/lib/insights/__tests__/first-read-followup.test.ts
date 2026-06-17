import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  findLayeredFirstRead,
  appendAssistantFollowup,
  snapshotConversationMetadata,
  refreshMerchantAggregates,
  claimUpgradeInProgress,
  clearUpgradeInProgress,
  markUpgraded,
  UPGRADE_IN_PROGRESS_KEY,
  UPGRADED_KEY,
} from '../first-read-followup'

type Call = {
  table: string
  method: string
  col?: string
  val?: unknown
  value?: unknown
}

/**
 * Chainable Supabase mock that records every call. Terminal reads resolve to
 * `readResult`; terminal writes resolve to `writeResult`. Matches the recorder
 * style used by the confirm-actions / markComplete tests.
 */
function mockClient(opts: {
  // result for `.maybeSingle()` after a select (read-modify-write reads)
  selectResult?: { data: unknown; error: unknown }
  // result for `.maybeSingle()` after an insert
  insertResult?: { data: unknown; error: unknown }
  // result for `.maybeSingle()` after an update (conditional claim)
  updateResult?: { data: unknown; error: unknown }
  // result for an awaited `.update(...).eq(...)` with no `.select()`
  updateNoSelectResult?: { error: unknown }
  rpcResult?: { error: unknown }
}) {
  const calls: Call[] = []
  // Track which terminal result to hand back: the last write verb seen decides.
  let lastWrite: 'insert' | 'update' | null = null

  function chain(table: string) {
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b,
      eq: (col: string, val: unknown) => {
        calls.push({ table, method: 'eq', col, val })
        return b
      },
      neq: (col: string, val: unknown) => {
        calls.push({ table, method: 'neq', col, val })
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
          return opts.insertResult ?? { data: null, error: null }
        }
        if (lastWrite === 'update') {
          lastWrite = null
          return opts.updateResult ?? { data: null, error: null }
        }
        return opts.selectResult ?? { data: null, error: null }
      },
      // Awaitable terminal for `update(...).eq(...)` without `.select()`.
      then: (resolve: (v: unknown) => unknown) =>
        resolve(opts.updateNoSelectResult ?? { error: null }),
    })
    return b
  }

  return {
    from: vi.fn((table: string) => chain(table)),
    rpc: vi.fn(async () => opts.rpcResult ?? { error: null }),
    _calls: calls,
  }
}

function find(client: { _calls: Call[] }, table: string, method: string) {
  return client._calls.filter((c) => c.table === table && c.method === method)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findLayeredFirstRead', () => {
  it('returns the row narrowed to { id, metadata } with the layered filters', async () => {
    const client = mockClient({
      selectResult: { data: { id: 'c1', metadata: { layered_read: true, foo: 1 } }, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await findLayeredFirstRead(client as any, 'u1')
    expect(res).toEqual({ id: 'c1', metadata: { layered_read: true, foo: 1 } })

    const eqs = find(client, 'conversations', 'eq')
    expect(eqs).toContainEqual({ table: 'conversations', method: 'eq', col: 'user_id', val: 'u1' })
    expect(eqs).toContainEqual({ table: 'conversations', method: 'eq', col: 'type', val: 'first_read' })
    expect(eqs).toContainEqual({
      table: 'conversations',
      method: 'eq',
      col: 'metadata->>layered_read',
      val: 'true',
    })
  })

  it('returns null when no conversation matches', async () => {
    const client = mockClient({ selectResult: { data: null, error: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await findLayeredFirstRead(client as any, 'u1')).toBeNull()
  })

  it('coerces a missing metadata to null', async () => {
    const client = mockClient({ selectResult: { data: { id: 'c1' }, error: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await findLayeredFirstRead(client as any, 'u1')).toEqual({ id: 'c1', metadata: null })
  })
})

describe('appendAssistantFollowup', () => {
  it('inserts the assistant row WITHOUT updated_at and returns the id', async () => {
    const client = mockClient({ insertResult: { data: { id: 'm1' }, error: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await appendAssistantFollowup(client as any, {
      conversationId: 'c1',
      userId: 'u1',
      content: 'hello',
    })
    expect(res).toEqual({ id: 'm1' })

    const inserts = find(client, 'messages', 'insert')
    expect(inserts).toHaveLength(1)
    const payload = inserts[0].value as Record<string, unknown>
    expect(payload).toEqual({
      conversation_id: 'c1',
      user_id: 'u1',
      role: 'assistant',
      content: 'hello',
    })
    // The load-bearing gotcha: messages has no updated_at column.
    expect(payload).not.toHaveProperty('updated_at')
  })

  it('returns id=null when the DB does not return a row', async () => {
    const client = mockClient({ insertResult: { data: null, error: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await appendAssistantFollowup(client as any, {
      conversationId: 'c1',
      userId: 'u1',
      content: 'x',
    })).toEqual({ id: null })
  })

  it('throws on insert error (so the route can 500)', async () => {
    const client = mockClient({ insertResult: { data: null, error: { message: 'boom' } } })
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appendAssistantFollowup(client as any, { conversationId: 'c1', userId: 'u1', content: 'x' }),
    ).rejects.toThrow(/boom/)
  })
})

describe('snapshotConversationMetadata', () => {
  it('merges patch onto prior metadata and sets updated_at', async () => {
    const client = mockClient({
      selectResult: { data: { metadata: { a: 1, keep: 'me' } }, error: null },
    })
    await snapshotConversationMetadata(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      { conversationId: 'c1', metadata: { b: 2 } },
    )

    const updates = find(client, 'conversations', 'update')
    expect(updates).toHaveLength(1)
    const payload = updates[0].value as Record<string, unknown>
    // Prior keys preserved, patch added, NOT clobbered.
    expect(payload.metadata).toEqual({ a: 1, keep: 'me', b: 2 })
    expect(typeof payload.updated_at).toBe('string')
  })

  it('patch wins on key collision (shallow merge)', async () => {
    const client = mockClient({
      selectResult: { data: { metadata: { a: 1 } }, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await snapshotConversationMetadata(client as any, {
      conversationId: 'c1',
      metadata: { a: 99 },
    })
    const payload = find(client, 'conversations', 'update')[0].value as Record<string, unknown>
    expect((payload.metadata as Record<string, unknown>).a).toBe(99)
  })

  it('treats missing prior metadata as {}', async () => {
    const client = mockClient({ selectResult: { data: {}, error: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await snapshotConversationMetadata(client as any, {
      conversationId: 'c1',
      metadata: { x: 1 },
    })
    const payload = find(client, 'conversations', 'update')[0].value as Record<string, unknown>
    expect(payload.metadata).toEqual({ x: 1 })
  })
})

describe('refreshMerchantAggregates', () => {
  it('calls the refresh_merchant_aggregates RPC', async () => {
    const client = mockClient({ rpcResult: { error: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refreshMerchantAggregates(client as any)
    expect(client.rpc).toHaveBeenCalledWith('refresh_merchant_aggregates')
  })

  it('does not throw when the RPC errors (non-fatal, matches post-upload)', async () => {
    const client = mockClient({ rpcResult: { error: { message: 'mv locked' } } })
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      refreshMerchantAggregates(client as any),
    ).resolves.toBeUndefined()
  })
})

describe('claimUpgradeInProgress', () => {
  it('returns claimed=false when value_first_upgraded is already set', async () => {
    const client = mockClient({
      selectResult: { data: { metadata: { [UPGRADED_KEY]: true } }, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await claimUpgradeInProgress(client as any, 'c1')).toEqual({ claimed: false })
    // Short-circuits before attempting any write.
    expect(find(client, 'conversations', 'update')).toHaveLength(0)
  })

  it('returns claimed=false when an in-progress claim is already live', async () => {
    const client = mockClient({
      selectResult: { data: { metadata: { [UPGRADE_IN_PROGRESS_KEY]: true } }, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await claimUpgradeInProgress(client as any, 'c1')).toEqual({ claimed: false })
    expect(find(client, 'conversations', 'update')).toHaveLength(0)
  })

  it('claims when no stamp is present and the guarded write lands a row', async () => {
    const client = mockClient({
      selectResult: { data: { metadata: {} }, error: null },
      updateResult: { data: { id: 'c1' }, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await claimUpgradeInProgress(client as any, 'c1')
    expect(res).toEqual({ claimed: true })

    // The write sets the in-progress flag and is guarded on absence of both keys.
    const update = find(client, 'conversations', 'update')[0].value as Record<string, unknown>
    expect((update.metadata as Record<string, unknown>)[UPGRADE_IN_PROGRESS_KEY]).toBe(true)
    const neqs = find(client, 'conversations', 'neq')
    expect(neqs.some((c) => c.col === 'metadata->>' + UPGRADED_KEY && c.val === 'true')).toBe(true)
    expect(
      neqs.some((c) => c.col === 'metadata->>' + UPGRADE_IN_PROGRESS_KEY && c.val === 'true'),
    ).toBe(true)
  })

  it('returns claimed=false when the guarded write matches no row (lost the race)', async () => {
    const client = mockClient({
      selectResult: { data: { metadata: {} }, error: null },
      updateResult: { data: null, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await claimUpgradeInProgress(client as any, 'c1')).toEqual({ claimed: false })
  })
})

describe('clearUpgradeInProgress / markUpgraded', () => {
  it('clearUpgradeInProgress sets the in-progress flag false', async () => {
    const client = mockClient({ selectResult: { data: { metadata: { [UPGRADE_IN_PROGRESS_KEY]: true } }, error: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await clearUpgradeInProgress(client as any, 'c1')
    const payload = find(client, 'conversations', 'update')[0].value as Record<string, unknown>
    expect((payload.metadata as Record<string, unknown>)[UPGRADE_IN_PROGRESS_KEY]).toBe(false)
  })

  it('markUpgraded stamps upgraded=true, clears in-progress, and merges extra', async () => {
    const client = mockClient({ selectResult: { data: { metadata: { [UPGRADE_IN_PROGRESS_KEY]: true, keep: 1 } }, error: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markUpgraded(client as any, 'c1', { upgrade_metadata: { x: 1 } })
    const meta = (find(client, 'conversations', 'update')[0].value as Record<string, unknown>)
      .metadata as Record<string, unknown>
    expect(meta[UPGRADED_KEY]).toBe(true)
    expect(meta[UPGRADE_IN_PROGRESS_KEY]).toBe(false)
    expect(meta.upgrade_metadata).toEqual({ x: 1 })
    expect(meta.keep).toBe(1)
  })
})
