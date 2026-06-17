import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ONLY the LLM composition — everything else (the follow-up helpers and the
// real read-judge close assertion) runs for real against the injected mock
// client, so the tests exercise the genuine guard/exit behaviour rather than a
// hand-stubbed orchestration.
const composeFirstRead = vi.fn()
vi.mock('@/lib/ai/compose-first-read', () => ({
  composeFirstRead: (...args: unknown[]) => composeFirstRead(...args),
}))

import { runDeclaredReadUpgrade } from '../route'
import {
  UPGRADE_IN_PROGRESS_KEY,
  UPGRADED_KEY,
} from '@/lib/insights/first-read-followup'

// ── Supabase mock ────────────────────────────────────────────────────────────
// Records every write so tests can assert what landed. Reads resolve to a
// per-table queue of results (FIFO); a count select resolves to `countResult`;
// writes resolve to their configured result. The conditional CLAIM update is
// emulated from the recorded guard filters against the conversation row's
// metadata, so the double-tap guard is exercised for real.

type Call = {
  table: string
  method: string
  col?: string
  val?: unknown
  value?: unknown
  filter?: string
  countOpt?: boolean
}

function evalOrGroup(filter: string, metadata: Record<string, unknown>): boolean {
  return filter.split(',').some((clause) => {
    const m = clause.match(/^metadata->>(.+?)\.(is|neq)\.(.+)$/)
    if (!m) return false
    const [, key, op, rhs] = m
    const present = Object.prototype.hasOwnProperty.call(metadata, key)
    const text = present ? String(metadata[key]) : null
    if (op === 'is') return rhs === 'null' ? text === null : false
    if (op === 'neq') return text !== null && text !== rhs
    return false
  })
}

type TableResults = {
  /** FIFO queue of `.maybeSingle()` read results for this table. */
  reads?: Array<{ data: unknown; error: unknown }>
  /** Result for a `head/count` select that is awaited directly (no maybeSingle). */
  count?: { count: number | null; error: unknown }
  insertResult?: { data: unknown; error: unknown }
}

function mockClient(tables: Record<string, TableResults> = {}) {
  const calls: Call[] = []

  function chain(table: string) {
    const t = tables[table] ?? {}
    let lastWrite: 'insert' | 'update' | null = null
    let isCountSelect = false
    const readQueue = [...(t.reads ?? [])]

    function emulateUpdateResult(): { data: unknown; error: unknown } {
      // Metadata of the row this client most recently read for `table`.
      const lastRead = (t.reads ?? [])
      const metaRow = lastRead.length > 0 ? (lastRead[0].data as { metadata?: Record<string, unknown> } | null) : null
      const meta = metaRow?.metadata ?? {}
      const idEq = calls.find((c) => c.table === table && c.method === 'eq' && c.col === 'id')
      const ors = calls.filter((c) => c.table === table && c.method === 'or' && typeof c.filter === 'string')
      const allOrsMatch = ors.every((c) => evalOrGroup(c.filter as string, meta))
      return allOrsMatch && idEq ? { data: { id: idEq.val }, error: null } : { data: null, error: null }
    }

    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: (_cols?: string, opts?: { head?: boolean; count?: string }) => {
        if (opts?.head || opts?.count) isCountSelect = true
        return b
      },
      eq: (col: string, val: unknown) => {
        calls.push({ table, method: 'eq', col, val })
        // A head/count select is awaited directly after its filters.
        if (isCountSelect) {
          return {
            ...b,
            then: (resolve: (v: unknown) => unknown) =>
              resolve(t.count ?? { count: 0, error: null }),
          }
        }
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
          return t.insertResult ?? { data: null, error: null }
        }
        if (lastWrite === 'update') {
          lastWrite = null
          return emulateUpdateResult()
        }
        return readQueue.shift() ?? { data: null, error: null }
      },
      // Awaitable terminal for `update(...).eq(...)` with no `.select()`.
      then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
    })
    return b
  }

  return {
    from: vi.fn((table: string) => chain(table)),
    rpc: vi.fn(async () => ({ error: null })),
    _calls: calls,
  }
}

function find(client: { _calls: Call[] }, table: string, method: string) {
  return client._calls.filter((c) => c.table === table && c.method === method)
}

// A well-formed value_first Read: signed off, one start_value_map_real CTA,
// statement-final, within the cap — passes the REAL checkReadHardRules.
const WELL_FORMED = `Your declared numbers said one thing; the statements say another. **Groceries** ran 540 a month across the window, not the figure you'd pencilled in. **Coffee** turned up 38 times.

Two of those I can read the rhythm of but not the why. Sorting them tells me which to leave alone and which to act on.

[CTA:start_value_map_real]Sort my real spending[/CTA]
— C.`

// Malformed: two CTAs, wrong type — fails H3/H3b.
const BAD_CLOSE = `Your statements are in. **Groceries** ran 540 a month.

[CTA:supply_input]Tell me more[/CTA]
[CTA:start_value_map_real]Sort it[/CTA]
— C.`

const GOOD_META = { mode: 'declared_upgrade', layers_used: ['L1', 'L2', 'L3'] }

beforeEach(() => {
  vi.clearAllMocks()
  composeFirstRead.mockReset()
})

// Convenience: a layered conversation read for findLayeredFirstRead, optionally
// with stamps on its metadata.
function conversationsTable(metadata: Record<string, unknown>): TableResults {
  return {
    reads: [
      // findLayeredFirstRead
      { data: { id: 'conv1', metadata }, error: null },
      // claimUpgradeInProgress read-modify-write read (uses same metadata)
      { data: { metadata }, error: null },
      // markUpgraded / clearUpgradeInProgress snapshot reads (best-effort)
      { data: { metadata }, error: null },
      { data: { metadata }, error: null },
    ],
  }
}

describe('runDeclaredReadUpgrade', () => {
  it('no-ops with 404 when there is no layered first_read conversation', async () => {
    const client = mockClient({ conversations: { reads: [{ data: null, error: null }] } })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ upgraded: false, reason: 'no_layered_read' })
    expect(composeFirstRead).not.toHaveBeenCalled()
  })

  it('already_upgraded → no-op (no compose, no claim)', async () => {
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true, [UPGRADED_KEY]: true }),
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ upgraded: false, reason: 'already_upgraded', conversationId: 'conv1' })
    expect(composeFirstRead).not.toHaveBeenCalled()
    // Never attempted a claim write on the conversation.
    expect(find(client, 'conversations', 'update')).toHaveLength(0)
  })

  it('no_transactions → skip (no claim, no compose)', async () => {
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true }),
      transactions: { count: { count: 0, error: null } },
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ upgraded: false, reason: 'no_transactions', conversationId: 'conv1' })
    expect(composeFirstRead).not.toHaveBeenCalled()
    expect(find(client, 'conversations', 'update')).toHaveLength(0)
  })

  it('count query error → 500, no claim/compose', async () => {
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true }),
      transactions: { count: { count: null, error: { message: 'boom' } } },
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ upgraded: false, reason: 'count_failed' })
    expect(composeFirstRead).not.toHaveBeenCalled()
  })

  it('in_progress (claim fails) → 409, no compose', async () => {
    // value_first_upgrade_in_progress already true → claim short-circuits false.
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true, [UPGRADE_IN_PROGRESS_KEY]: true }),
      transactions: { count: { count: 12, error: null } },
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ upgraded: false, reason: 'in_progress', conversationId: 'conv1' })
    expect(composeFirstRead).not.toHaveBeenCalled()
  })

  it('insufficient_data → decline: NO append, NO markUpgraded, in-progress CLEARED', async () => {
    composeFirstRead.mockResolvedValue({
      composedMessage: '',
      metadata: { mode: 'declared_upgrade' },
      insufficientData: true,
    })
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true }),
      transactions: { count: { count: 30, error: null } },
      messages: { reads: [{ data: { content: 'Declared first sentence. More.' }, error: null }] },
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ upgraded: false, reason: 'insufficient_data', conversationId: 'conv1' })
    // No assistant message appended.
    expect(find(client, 'messages', 'insert')).toHaveLength(0)
    // in-progress was cleared (a conversations update setting the flag false),
    // and the upgraded flag was NEVER set true.
    const updates = find(client, 'conversations', 'update').map((c) => c.value as Record<string, unknown>)
    const clearWrite = updates.find(
      (u) => (u.metadata as Record<string, unknown>)?.[UPGRADE_IN_PROGRESS_KEY] === false,
    )
    expect(clearWrite).toBeDefined()
    expect(
      updates.some((u) => (u.metadata as Record<string, unknown>)?.[UPGRADED_KEY] === true),
    ).toBe(false)
  })

  it('bad_close → no append + in-progress cleared + 500 (real close assertion)', async () => {
    composeFirstRead.mockResolvedValue({
      composedMessage: BAD_CLOSE,
      metadata: GOOD_META,
    })
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true }),
      transactions: { count: { count: 30, error: null } },
      messages: { reads: [{ data: { content: 'Declared first sentence. More.' }, error: null }] },
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ upgraded: false, reason: 'bad_close' })
    expect(find(client, 'messages', 'insert')).toHaveLength(0)
    const updates = find(client, 'conversations', 'update').map((c) => c.value as Record<string, unknown>)
    expect(
      updates.some((u) => (u.metadata as Record<string, unknown>)?.[UPGRADE_IN_PROGRESS_KEY] === false),
    ).toBe(true)
    expect(
      updates.some((u) => (u.metadata as Record<string, unknown>)?.[UPGRADED_KEY] === true),
    ).toBe(false)
  })

  it('success → appends once + markUpgraded (upgraded=true, in-progress cleared, metadata snapshot)', async () => {
    composeFirstRead.mockResolvedValue({
      composedMessage: WELL_FORMED,
      metadata: GOOD_META,
    })
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true }),
      transactions: { count: { count: 42, error: null } },
      messages: {
        reads: [{ data: { content: 'Declared first sentence. More.' }, error: null }],
        insertResult: { data: { id: 'm-new' }, error: null },
      },
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ upgraded: true, conversationId: 'conv1' })

    // Composed in declared_upgrade mode with a declared PriorReadSummary.
    expect(composeFirstRead).toHaveBeenCalledTimes(1)
    const composeArg = composeFirstRead.mock.calls[0][0] as Record<string, unknown>
    expect(composeArg.mode).toBe('declared_upgrade')
    const prior = composeArg.priorReadSummary as Record<string, unknown>
    expect(prior).toMatchObject({
      layer1Stated: true,
      goalStatedAsReveal: true,
      merchantsAlreadyNamed: [],
      hookMerchantsUsed: [],
      firstSentence: 'Declared first sentence.',
    })

    // Exactly one assistant message appended, with the composed content.
    const inserts = find(client, 'messages', 'insert')
    expect(inserts).toHaveLength(1)
    expect((inserts[0].value as Record<string, unknown>).content).toBe(WELL_FORMED)

    // markUpgraded stamped upgraded=true, cleared in-progress, snapshotted meta.
    const updates = find(client, 'conversations', 'update').map((c) => c.value as Record<string, unknown>)
    const stamp = updates.find((u) => (u.metadata as Record<string, unknown>)?.[UPGRADED_KEY] === true)
    expect(stamp).toBeDefined()
    const stampMeta = stamp!.metadata as Record<string, unknown>
    expect(stampMeta[UPGRADE_IN_PROGRESS_KEY]).toBe(false)
    expect(stampMeta.first_read_metadata_upgraded).toEqual(GOOD_META)
  })

  it('compose throws → in-progress cleared + 500, no markUpgraded, no append', async () => {
    composeFirstRead.mockRejectedValue(new Error('bedrock exploded'))
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true }),
      transactions: { count: { count: 42, error: null } },
      messages: { reads: [{ data: { content: 'Declared first sentence. More.' }, error: null }] },
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ upgraded: false, reason: 'compose_failed' })
    expect(find(client, 'messages', 'insert')).toHaveLength(0)
    const updates = find(client, 'conversations', 'update').map((c) => c.value as Record<string, unknown>)
    expect(
      updates.some((u) => (u.metadata as Record<string, unknown>)?.[UPGRADE_IN_PROGRESS_KEY] === false),
    ).toBe(true)
    expect(
      updates.some((u) => (u.metadata as Record<string, unknown>)?.[UPGRADED_KEY] === true),
    ).toBe(false)
  })
})
