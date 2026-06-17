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
  /** the raw PostgREST filter string passed to `.or(...)` */
  filter?: string
}

/**
 * Evaluate a single PostgREST `.or(...)` filter string against a metadata row,
 * supporting exactly the operators `claimUpgradeInProgress`'s guard uses:
 * `metadata->>key.is.null` and `metadata->>key.neq.<value>`. Returns whether the
 * OR-group is satisfied. This lets the mock emulate the DB's NULL semantics so
 * the claim tests exercise the real filter shape rather than a hard-coded
 * update result.
 *
 * IMPORTANT (the bug this whole file guards): a plain `.neq('metadata->>key',
 * 'true')` is SQL `metadata->>key <> 'true'`. When the key is ABSENT,
 * `metadata->>key` is NULL and `NULL <> 'true'` is NULL (NOT true) — so the row
 * is EXCLUDED from the update. The fix uses `(key IS NULL OR key <> 'true')`,
 * which is `IS DISTINCT FROM 'true'` and correctly includes absent/false keys.
 */
function evalOrGroup(filter: string, metadata: Record<string, unknown>): boolean {
  return filter.split(',').some((clause) => {
    const m = clause.match(/^metadata->>(.+?)\.(is|neq)\.(.+)$/)
    if (!m) return false
    const [, key, op, rhs] = m
    const present = Object.prototype.hasOwnProperty.call(metadata, key)
    // PostgREST `metadata->>key` is NULL when the key is absent; otherwise the
    // value coerced to text ('true' / 'false' for booleans).
    const text = present ? String(metadata[key]) : null
    if (op === 'is') return rhs === 'null' ? text === null : false
    // neq: SQL <> — NULL on either side yields NULL (treated as not-matched).
    if (op === 'neq') return text !== null && text !== rhs
    return false
  })
}

/**
 * Chainable Supabase mock that records every call. Terminal reads resolve to
 * `selectResult`; terminal inserts resolve to `insertResult`.
 *
 * For the conditional CLAIM update, the mock EMULATES the DB instead of handing
 * back a hard-coded `updateResult`: it evaluates the recorded `.eq` + `.or`
 * filters against the metadata from `selectResult` (the row being updated). The
 * update "lands a row" only if every filter matches — so the claim tests assert
 * real behaviour and a regression to plain `.neq` (which excludes absent keys)
 * would flip the result and FAIL. Callers may still force a result with
 * `updateResult` (used to simulate the lost-race / zero-row case directly).
 */
function mockClient(opts: {
  // result for `.maybeSingle()` after a select (read-modify-write reads)
  selectResult?: { data: unknown; error: unknown }
  // result for `.maybeSingle()` after an insert
  insertResult?: { data: unknown; error: unknown }
  // result for `.maybeSingle()` after an update (conditional claim). When
  // provided, OVERRIDES the emulated filter evaluation.
  updateResult?: { data: unknown; error: unknown }
  // result for an awaited `.update(...).eq(...)` with no `.select()`
  updateNoSelectResult?: { error: unknown }
  rpcResult?: { error: unknown }
}) {
  const calls: Call[] = []
  // Track which terminal result to hand back: the last write verb seen decides.
  let lastWrite: 'insert' | 'update' | null = null

  // Compute the update row by emulating the recorded WHERE filters against the
  // metadata of the row read in step 1 (selectResult). Returns { id } when the
  // guard matches, null otherwise — mirroring `RETURNING id` on zero rows.
  function emulateUpdateResult(): { data: unknown; error: unknown } {
    const meta =
      ((opts.selectResult?.data as { metadata?: Record<string, unknown> } | null)?.metadata) ?? {}
    const updateCall = calls.find((c) => c.method === 'update')
    if (!updateCall) return { data: null, error: null }
    // The id this update targets, from the `.eq('id', ...)` after `.update(...)`.
    const idEq = calls.find((c) => c.method === 'eq' && c.col === 'id')
    const ors = calls.filter((c) => c.method === 'or' && typeof c.filter === 'string')
    // Each `.or()` group is ANDed; all must be satisfied for a row to match.
    const allOrsMatch = ors.every((c) => evalOrGroup(c.filter as string, meta))
    // Also emulate any bare `.neq('metadata->>key', v)` on a JSONB stamp key,
    // with the SAME NULL semantics as Postgres: an ABSENT key is NULL and
    // `NULL <> v` is NULL → NOT matched (this is exactly the regression we want
    // a `.neq`-only guard to trip over). A non-JSONB `.neq` (e.g. on a plain
    // column) is ignored here — none are used by this function.
    const jsonbNeqsMatch = calls
      .filter((c) => c.method === 'neq' && typeof c.col === 'string' && c.col.startsWith('metadata->>'))
      .every((c) => {
        const key = (c.col as string).slice('metadata->>'.length)
        const present = Object.prototype.hasOwnProperty.call(meta, key)
        const text = present ? String(meta[key]) : null
        return text !== null && text !== c.val // NULL <> v is NULL → excluded
      })
    const matched = allOrsMatch && jsonbNeqsMatch
    return matched && idEq ? { data: { id: idEq.val }, error: null } : { data: null, error: null }
  }

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
      or: (filter: string) => {
        calls.push({ table, method: 'or', filter })
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
          // Explicit override wins; otherwise emulate the DB's filter semantics.
          return opts.updateResult ?? emulateUpdateResult()
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
  // ── Filter-shape guard ─────────────────────────────────────────────────────
  // These assert the WHERE clause is NULL-aware (IS DISTINCT FROM 'true'),
  // expressed as one `.or('K.is.null,K.neq.true')` per key. This is what catches
  // a regression: a JSONB key that is ABSENT yields `metadata->>key = NULL`, and
  // `NULL <> 'true'` is NULL (not true), so a plain `.neq('metadata->>key',
  // 'true')` EXCLUDES the row — denying every legitimate first claim. The `.or`
  // form `(key IS NULL OR key <> 'true')` includes absent/false keys correctly.

  it('guards the write with a NULL-aware `.or` per key (not bare `.neq`)', async () => {
    const client = mockClient({
      selectResult: { data: { metadata: {} }, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await claimUpgradeInProgress(client as any, 'c1')

    const ors = find(client, 'conversations', 'or')
    // One `.or` group per key, each including the `is.null` (NULL-aware) clause.
    expect(
      ors.some(
        (c) =>
          c.filter === `metadata->>${UPGRADE_IN_PROGRESS_KEY}.is.null,metadata->>${UPGRADE_IN_PROGRESS_KEY}.neq.true`,
      ),
    ).toBe(true)
    expect(
      ors.some(
        (c) => c.filter === `metadata->>${UPGRADED_KEY}.is.null,metadata->>${UPGRADED_KEY}.neq.true`,
      ),
    ).toBe(true)
    // Every guard `.or` must carry an `is.null` clause — a regression to bare
    // `.neq` would drop these and this assertion would fail.
    expect(ors.length).toBeGreaterThanOrEqual(2)
    expect(ors.every((c) => (c.filter as string).includes('.is.null'))).toBe(true)
    // And no bare `.neq` guard on the stamp keys (the buggy form).
    const neqs = find(client, 'conversations', 'neq')
    expect(neqs.some((c) => c.col === 'metadata->>' + UPGRADED_KEY)).toBe(false)
    expect(neqs.some((c) => c.col === 'metadata->>' + UPGRADE_IN_PROGRESS_KEY)).toBe(false)
  })

  // ── Behavioural assertions (driven by the filter-emulating mock) ────────────
  // The mock evaluates the recorded `.eq`/`.or` filters against the row metadata
  // (no hard-coded updateResult), so these would FAIL against the old `.neq`
  // guard: on metadata `{}`, `NULL <> 'true'` excludes the row and claimed would
  // be false instead of true.

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

  it('claims on a clean `{}` row — the absent-key case the bug denied', async () => {
    // No `updateResult`: the mock derives the outcome from the guard filters
    // applied to metadata `{}`. With the NULL-aware `.or`, both keys are absent,
    // so the row matches and a row comes back → claimed:true. With the old
    // `.neq`, `NULL <> 'true'` excludes the row → this would be claimed:false.
    const client = mockClient({
      selectResult: { data: { metadata: {} }, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await claimUpgradeInProgress(client as any, 'c1')
    expect(res).toEqual({ claimed: true })

    // The write sets the in-progress flag, merging non-destructively.
    const update = find(client, 'conversations', 'update')[0].value as Record<string, unknown>
    expect((update.metadata as Record<string, unknown>)[UPGRADE_IN_PROGRESS_KEY]).toBe(true)
  })

  it('claims on a post-clear retry (in_progress:false) — the other NULL-equivalent case', async () => {
    // After clearUpgradeInProgress the flag is `false`, not absent. `false <>
    // 'true'` IS true, so this case survived even the old `.neq`; assert it
    // still claims under the NULL-aware guard and merges non-destructively.
    const client = mockClient({
      selectResult: { data: { metadata: { [UPGRADE_IN_PROGRESS_KEY]: false, keep: 1 } }, error: null },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await claimUpgradeInProgress(client as any, 'c1')
    expect(res).toEqual({ claimed: true })
    const update = find(client, 'conversations', 'update')[0].value as Record<string, unknown>
    const meta = update.metadata as Record<string, unknown>
    expect(meta[UPGRADE_IN_PROGRESS_KEY]).toBe(true)
    expect(meta.keep).toBe(1) // prior keys preserved (non-clobbering merge)
  })

  it('returns claimed=false when the guarded write matches no row (lost the race)', async () => {
    // Force the zero-row outcome directly to model a concurrent caller having
    // stamped the row between our read and the write's recheck.
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
