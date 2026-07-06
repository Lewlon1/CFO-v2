import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ONLY the LLM composition — everything else (the follow-up helpers and the
// real read-judge close assertion) runs for real against the injected mock
// client, so the tests exercise the genuine guard/exit behaviour rather than a
// hand-stubbed orchestration.
const composeFirstRead = vi.fn()
vi.mock('@/lib/ai/compose-first-read', () => ({
  composeFirstRead: (...args: unknown[]) => composeFirstRead(...args),
}))

import { runDeclaredReadUpgrade, parseDeclaredFactsSnapshot } from '../route'
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
  /**
   * When set, any `update(value)` whose value matches makes the write REJECT
   * (simulating a transient DB blip). Used to drive the markUpgraded /
   * clearUpgradeInProgress failure paths. Stays armed across calls, so a single
   * predicate covers all of markUpgraded's retry attempts.
   */
  updateThrowsWhen?: (value: Record<string, unknown>) => boolean
  /** Error thrown when `updateThrowsWhen` matches (defaults to a generic blip). */
  updateError?: Error
  /** When set, `insert(...)` REJECTS — simulates appendAssistantFollowup failing. */
  insertThrows?: Error
}

function mockClient(tables: Record<string, TableResults> = {}) {
  const calls: Call[] = []

  function chain(table: string) {
    const t = tables[table] ?? {}
    let lastWrite: 'insert' | 'update' | null = null
    let isCountSelect = false
    let lastUpdateValue: Record<string, unknown> | null = null
    const readQueue = [...(t.reads ?? [])]

    // True when the most recent update on this chain is configured to reject.
    function updateShouldThrow(): boolean {
      return Boolean(
        t.updateThrowsWhen &&
          lastUpdateValue &&
          t.updateThrowsWhen(lastUpdateValue),
      )
    }

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
        lastUpdateValue = value as Record<string, unknown>
        return b
      },
      maybeSingle: async () => {
        if (lastWrite === 'insert') {
          lastWrite = null
          if (t.insertThrows) throw t.insertThrows
          return t.insertResult ?? { data: null, error: null }
        }
        if (lastWrite === 'update') {
          lastWrite = null
          if (updateShouldThrow()) {
            throw t.updateError ?? new Error('update blip')
          }
          return emulateUpdateResult()
        }
        return readQueue.shift() ?? { data: null, error: null }
      },
      // Awaitable terminal for `update(...).eq(...)` with no `.select()`.
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (lastWrite === 'update' && updateShouldThrow()) {
          lastWrite = null
          const err = t.updateError ?? new Error('update blip')
          return reject ? reject(err) : Promise.reject(err)
        }
        return resolve({ error: null })
      },
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
    // No declared_facts snapshot on this conversation → the numeric delta is
    // withheld (snapshot-only contract), never guessed.
    expect(composeArg.declaredPriorFacts).toBeNull()

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

    // The delivered Read also clears the profile's declared-pending flag so
    // post-onboarding surfaces stop advertising the upgrade.
    const profileUpdates = find(client, 'user_profiles', 'update').map(
      (c) => c.value as Record<string, unknown>,
    )
    expect(profileUpdates).toHaveLength(1)
    expect(
      (profileUpdates[0].onboarding_progress as Record<string, unknown>).declared_read_pending,
    ).toBeNull()
  })

  it('threads the declared_facts snapshot into the compose when the conversation carries one', async () => {
    composeFirstRead.mockResolvedValue({
      composedMessage: WELL_FORMED,
      metadata: GOOD_META,
    })
    const snapshot = {
      income: 2800,
      totalFixedCosts: 900,
      freeCash: 1900,
      goalName: 'House deposit',
      goalTargetAmount: 40_000,
      goalCurrentAmount: 5_000,
      goalTargetDate: '2028-03-01',
      monthlyRequiredSaving: 1750,
      percentOfIncome: 63,
      unallocated: 150,
      currency: 'GBP',
    }
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true, declared_facts: snapshot }),
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
    const composeArg = composeFirstRead.mock.calls[0][0] as Record<string, unknown>
    // Snapshots that predate the goalType/funded-at-plan fields parse with the
    // safe defaults appended (fundedAtPlan false → on-track framing never fires).
    expect(composeArg.declaredPriorFacts).toEqual({
      ...snapshot,
      goalType: null,
      fundedAtPlan: false,
      planRatePct: null,
      stressRatePct: null,
      stressMonthly: null,
      stressCovered: null,
    })
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

  it('append throws → in-progress CLEARED (retry-safe), markUpgraded never called', async () => {
    // Compose + close assertion pass; the assistant-message insert itself fails
    // BEFORE delivery. Nothing reached the chat, so this is retry-safe: clear the
    // claim, never stamp.
    composeFirstRead.mockResolvedValue({
      composedMessage: WELL_FORMED,
      metadata: GOOD_META,
    })
    const client = mockClient({
      conversations: conversationsTable({ layered_read: true }),
      transactions: { count: { count: 42, error: null } },
      messages: {
        reads: [{ data: { content: 'Declared first sentence. More.' }, error: null }],
        insertThrows: new Error('insert exploded'),
      },
    })
    const res = await runDeclaredReadUpgrade({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: client as any,
      userId: 'u1',
    })
    expect(res.status).toBe(500)
    // Append failed before delivery → retry-safe compose_failed, NOT stamp_failed.
    expect(res.body).toMatchObject({ upgraded: false, reason: 'compose_failed' })

    const updates = find(client, 'conversations', 'update').map((c) => c.value as Record<string, unknown>)
    // in-progress was cleared so a retry can proceed.
    expect(
      updates.some((u) => (u.metadata as Record<string, unknown>)?.[UPGRADE_IN_PROGRESS_KEY] === false),
    ).toBe(true)
    // markUpgraded never ran: no update ever set value_first_upgraded=true.
    expect(
      updates.some((u) => (u.metadata as Record<string, unknown>)?.[UPGRADED_KEY] === true),
    ).toBe(false)
  })

  it('append OK but markUpgraded throws (after retries) → in-progress NOT cleared (next call 409s), no 2nd append, stamp_failed', async () => {
    // Compose + close assertion + append all succeed; the FINAL stamp fails on
    // every retry. The Read is already in the chat, so the failure path must
    // leave the conversation claimed: a delivered-but-unstamped Read deliberately
    // blocks retries to avoid a duplicate in-chat Read.
    composeFirstRead.mockResolvedValue({
      composedMessage: WELL_FORMED,
      metadata: GOOD_META,
    })
    const client = mockClient({
      conversations: {
        ...conversationsTable({ layered_read: true }),
        // markUpgraded's write sets value_first_upgraded=true — make THAT update
        // (and only that one) reject on every retry attempt. The claim update and
        // any clear update don't set UPGRADED_KEY, so they're unaffected.
        updateThrowsWhen: (value) =>
          (value.metadata as Record<string, unknown> | undefined)?.[UPGRADED_KEY] === true,
        updateError: new Error('stamp blip'),
      },
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
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ upgraded: false, reason: 'stamp_failed', conversationId: 'conv1' })

    // The Read WAS appended exactly once — a retry must not append a second.
    const inserts = find(client, 'messages', 'insert')
    expect(inserts).toHaveLength(1)
    expect((inserts[0].value as Record<string, unknown>).content).toBe(WELL_FORMED)

    // markUpgraded was retried the configured number of times (all failed).
    const stampAttempts = find(client, 'conversations', 'update').filter(
      (c) => (((c.value as Record<string, unknown>).metadata) as Record<string, unknown>)?.[UPGRADED_KEY] === true,
    )
    expect(stampAttempts.length).toBeGreaterThanOrEqual(2)

    const updates = find(client, 'conversations', 'update').map((c) => c.value as Record<string, unknown>)
    // CRITICAL: no standalone clearUpgradeInProgress ran after the append. The
    // catch must NOT clear the claim once the Read is delivered. A standalone
    // clear writes ONLY { in_progress: false }; markUpgraded's (rejected) writes
    // carry in_progress:false alongside upgraded:true, so we exclude those — they
    // threw and changed no state. The conversation stays claimed → a retry 409s.
    const standaloneClears = updates.filter(
      (u) =>
        (u.metadata as Record<string, unknown>)?.[UPGRADE_IN_PROGRESS_KEY] === false &&
        (u.metadata as Record<string, unknown>)?.[UPGRADED_KEY] !== true,
    )
    expect(standaloneClears).toHaveLength(0)

    // The declared-pending flag DOES clear on this path — the Read is delivered
    // even though the stamp failed, so the pinned meter / re-offer banner must
    // stop advertising the upgrade.
    const profileUpdates = find(client, 'user_profiles', 'update').map(
      (c) => c.value as Record<string, unknown>,
    )
    expect(profileUpdates).toHaveLength(1)
    expect(
      (profileUpdates[0].onboarding_progress as Record<string, unknown>).declared_read_pending,
    ).toBeNull()
  })

  it('after a delivered-but-unstamped Read, a subsequent call 409s (no duplicate append)', async () => {
    // Simulate the retry that follows the stamp_failed case above: the
    // conversation is still claimed (value_first_upgrade_in_progress=true,
    // value_first_upgraded absent), so the claim short-circuits to 409 and we
    // never compose or append again.
    const client = mockClient({
      conversations: conversationsTable({
        layered_read: true,
        [UPGRADE_IN_PROGRESS_KEY]: true,
      }),
      transactions: { count: { count: 42, error: null } },
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
    expect(find(client, 'messages', 'insert')).toHaveLength(0)
  })
})

describe('parseDeclaredFactsSnapshot', () => {
  const valid = {
    income: 2800,
    totalFixedCosts: 900,
    freeCash: 1900,
    goalName: 'House deposit',
    goalTargetAmount: 40_000,
    goalCurrentAmount: 5_000,
    goalTargetDate: '2028-03-01',
    monthlyRequiredSaving: 1750,
    percentOfIncome: 63,
    unallocated: 150,
    currency: 'GBP',
  }

  it('round-trips a well-formed snapshot (new fields defaulted for older snapshots)', () => {
    expect(parseDeclaredFactsSnapshot(valid)).toEqual({
      ...valid,
      goalType: null,
      fundedAtPlan: false,
      planRatePct: null,
      stressRatePct: null,
      stressMonthly: null,
      stressCovered: null,
    })
  })

  it('returns null for absent / non-object values (pre-snapshot conversations)', () => {
    expect(parseDeclaredFactsSnapshot(undefined)).toBeNull()
    expect(parseDeclaredFactsSnapshot(null)).toBeNull()
    expect(parseDeclaredFactsSnapshot('legacy')).toBeNull()
  })

  it('returns null when a required numeric field is missing or mistyped', () => {
    expect(parseDeclaredFactsSnapshot({ ...valid, freeCash: undefined })).toBeNull()
    expect(parseDeclaredFactsSnapshot({ ...valid, totalFixedCosts: '900' })).toBeNull()
  })

  it('nulls optional fields that are missing or mistyped rather than rejecting', () => {
    const parsed = parseDeclaredFactsSnapshot({
      income: 2000,
      totalFixedCosts: 1200,
      freeCash: 800,
      currency: 'EUR',
      goalTargetAmount: 'not-a-number',
    })
    expect(parsed).toMatchObject({
      income: 2000,
      totalFixedCosts: 1200,
      freeCash: 800,
      currency: 'EUR',
      goalName: null,
      goalTargetAmount: null,
      monthlyRequiredSaving: null,
    })
  })
})
