import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  archiveFile,
  getFile,
  listFolder,
  loadMemoryIndex,
  renderMemoryIndex,
  slugify,
  writeFile,
  type MemoryIndexEntry,
} from './files'
import { INDEX_MAX_LINES_PER_FOLDER, MAX_CONTENT_CHARS, MAX_FILES_PER_FOLDER } from './constants'

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the two tables, driven through the same
// PostgREST-ish builder chain the real client exposes. Richer than the usual
// per-table stub in this repo (goals/pace.test.ts) because these tests are about
// what actually lands in the rows — duplicate rejection, revision snapshots,
// pruning — which a filter-ignoring stub cannot show.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface Store {
  memory_files: Row[]
  memory_file_revisions: Row[]
  /** Base epoch ms; every simulated write advances it, so rows sort stably. */
  seq: number
}

const BASE_MS = Date.UTC(2026, 7, 12, 9, 0, 0) // 12 August 2026

function makeStore(): Store {
  return { memory_files: [], memory_file_revisions: [], seq: 0 }
}

function tick(store: Store): string {
  store.seq += 1
  return new Date(BASE_MS + store.seq * 1000).toISOString()
}

type Filter = { col: string; op: 'eq' | 'is' | 'in'; val: unknown }

function makeClient(store: Store): SupabaseClient {
  function builder(table: 'memory_files' | 'memory_file_revisions') {
    const filters: Filter[] = []
    const orders: Array<{ col: string; asc: boolean }> = []
    let projection: string | null = null
    let action: { kind: 'select' } | { kind: 'insert'; payload: Row } | { kind: 'update'; patch: Row } | { kind: 'delete' } = { kind: 'select' }

    const matches = (row: Row) =>
      filters.every((f) => {
        if (f.op === 'in') return (f.val as unknown[]).includes(row[f.col])
        return row[f.col] === f.val
      })

    const project = (row: Row): Row => {
      if (!projection || projection === '*') return { ...row }
      const cols = projection.split(',').map((c) => c.trim()).filter(Boolean)
      const out: Row = {}
      for (const col of cols) out[col] = row[col]
      return out
    }

    const compare = (a: Row, b: Row): number => {
      for (const { col, asc } of orders) {
        const av = a[col]
        const bv = b[col]
        if (av === bv) continue
        let cmp: number
        if (typeof av === 'boolean' || typeof bv === 'boolean') {
          cmp = (av ? 1 : 0) - (bv ? 1 : 0)
        } else {
          cmp = String(av) < String(bv) ? -1 : 1
        }
        return asc ? cmp : -cmp
      }
      return 0
    }

    function run(): { rows: Row[]; error: { code?: string; message: string } | null } {
      const table_ = store[table]

      if (action.kind === 'insert') {
        const payload = action.payload
        if (table === 'memory_files') {
          const clash = table_.some(
            (r) =>
              r.user_id === payload.user_id &&
              r.folder === payload.folder &&
              r.slug === payload.slug,
          )
          // Simulates UNIQUE (user_id, folder, slug).
          if (clash) return { rows: [], error: { code: '23505', message: 'duplicate key' } }
        }
        const stamp = tick(store)
        const row: Row = {
          id: `${table}-${store.seq}`,
          created_at: stamp,
          updated_at: stamp,
          source: 'cfo',
          updated_by: 'cfo',
          pinned: false,
          archived_at: null,
          user_edited_at: null,
          superseded_by: 'cfo',
          ...payload,
        }
        table_.push(row)
        return { rows: [row], error: null }
      }

      if (action.kind === 'update') {
        const hit = table_.filter(matches)
        for (const row of hit) {
          Object.assign(row, action.patch)
          // Simulates the handle_updated_at trigger from migration 082.
          if (table === 'memory_files') row.updated_at = tick(store)
        }
        return { rows: hit, error: null }
      }

      if (action.kind === 'delete') {
        const hit = table_.filter(matches)
        store[table] = table_.filter((r) => !hit.includes(r))
        return { rows: hit, error: null }
      }

      const hit = table_.filter(matches)
      if (orders.length > 0) hit.sort(compare)
      return { rows: hit, error: null }
    }

    const api = {
      select(cols?: string) {
        projection = cols ?? '*'
        return api
      },
      insert(payload: Row) {
        action = { kind: 'insert', payload }
        return api
      },
      update(patch: Row) {
        action = { kind: 'update', patch }
        return api
      },
      delete() {
        action = { kind: 'delete' }
        return api
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: 'eq', val })
        return api
      },
      is(col: string, val: unknown) {
        filters.push({ col, op: 'is', val })
        return api
      },
      in(col: string, val: unknown[]) {
        filters.push({ col, op: 'in', val })
        return api
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, asc: opts?.ascending !== false })
        return api
      },
      single() {
        const { rows, error } = run()
        if (error) return Promise.resolve({ data: null, error })
        if (rows.length !== 1) {
          return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
        }
        return Promise.resolve({ data: project(rows[0]), error: null })
      },
      maybeSingle() {
        const { rows, error } = run()
        if (error) return Promise.resolve({ data: null, error })
        if (rows.length > 1) {
          return Promise.resolve({ data: null, error: { message: 'multiple rows' } })
        }
        return Promise.resolve({ data: rows[0] ? project(rows[0]) : null, error: null })
      },
      then(resolve: (v: { data: Row[] | null; error: unknown }) => unknown) {
        const { rows, error } = run()
        return resolve(error ? { data: null, error } : { data: rows.map(project), error: null })
      },
    }
    return api
  }

  return { from: (table: string) => builder(table as 'memory_files') } as unknown as SupabaseClient
}

const USER = 'user-1'

function seedFile(store: Store, row: Partial<Row> & { slug: string }): Row {
  const stamp = tick(store)
  const full: Row = {
    id: `file-${store.seq}`,
    user_id: USER,
    folder: 'goals',
    title: 'Seeded file',
    description: 'A seeded file',
    content: 'Seeded body.',
    source: 'cfo',
    updated_by: 'cfo',
    user_edited_at: null,
    pinned: false,
    archived_at: null,
    created_at: stamp,
    updated_at: stamp,
    ...row,
  }
  store.memory_files.push(full)
  return full
}

let store: Store
let client: SupabaseClient

beforeEach(() => {
  store = makeStore()
  client = makeClient(store)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Silences the deliberate `[memory:…]` error logs a few tests provoke. */
function muteConsole() {
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and hyphenates a title', () => {
    expect(slugify('House Deposit Plan')).toBe('house-deposit-plan')
  })

  it('collapses runs of punctuation and whitespace into one hyphen', () => {
    expect(slugify('Rent  &&  bills!!! 2026')).toBe('rent-bills-2026')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Hello--  ')).toBe('hello')
  })

  it('strips accents rather than dropping the letter', () => {
    expect(slugify('Ñandú café fund')).toBe('nandu-cafe-fund')
  })

  it('returns an empty string when nothing survives', () => {
    expect(slugify('!!! ??? ...')).toBe('')
  })

  it('truncates to 64 characters without leaving a trailing hyphen', () => {
    const slug = slugify(`${'x'.repeat(63)} y`)
    expect(slug).toBe('x'.repeat(63))
    expect(slug.length).toBeLessThanOrEqual(64)
    expect(slug.endsWith('-')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('writeFile — create', () => {
  it('derives the slug from the title and stamps the actor', async () => {
    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'create',
      title: 'House Deposit Plan',
      description: 'Saving €40k by 2028; tension with the wedding fund',
      content: 'The plan is €900/month.',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.slug).toBe('house-deposit-plan')
    expect(result.value.source).toBe('cfo')
    expect(result.value.updated_by).toBe('cfo')
    expect(store.memory_files).toHaveLength(1)
  })

  it('honours an explicit slug and a non-cfo actor', async () => {
    const result = await writeFile(
      client,
      USER,
      {
        folder: 'cashflow',
        mode: 'create',
        slug: 'monthly-digest',
        title: 'Monthly digest',
        description: 'Rolling summary of the month',
        content: 'August: flat.',
      },
      { actor: 'system' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.slug).toBe('monthly-digest')
    expect(result.value.source).toBe('system')
  })

  it('rejects a duplicate slug and points at append/replace', async () => {
    seedFile(store, { slug: 'house-deposit-plan', folder: 'goals' })

    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'create',
      title: 'House deposit plan',
      description: 'Another go at the same thing',
      content: 'Body.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('goals/house-deposit-plan already exists')
    expect(result.error).toContain("mode 'append'")
    expect(result.error).toContain("mode 'replace'")
    expect(store.memory_files).toHaveLength(1)
  })

  it('rejects a slug taken by an archived file with a different instruction', async () => {
    seedFile(store, {
      slug: 'house-deposit-plan',
      folder: 'goals',
      archived_at: '2026-07-01T00:00:00.000Z',
    })

    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'create',
      title: 'House deposit plan',
      description: 'Reviving an old idea',
      content: 'Body.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('archived')
    expect(result.error).not.toContain("mode 'append'")
  })

  it('enforces the per-folder cap on active files only', async () => {
    for (let i = 0; i < MAX_FILES_PER_FOLDER; i += 1) {
      seedFile(store, { slug: `file-${i}`, folder: 'values' })
    }

    const blocked = await writeFile(client, USER, {
      folder: 'values',
      mode: 'create',
      title: 'One too many',
      description: 'Should not fit',
      content: 'Body.',
    })

    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.error).toContain(`full (${MAX_FILES_PER_FOLDER} files)`)
    expect(blocked.error).toContain('archive one')

    // Archiving one frees a slot — the cap counts active files, not rows.
    store.memory_files[0].archived_at = '2026-08-01T00:00:00.000Z'
    const allowed = await writeFile(client, USER, {
      folder: 'values',
      mode: 'create',
      title: 'Now it fits',
      description: 'Should fit',
      content: 'Body.',
    })
    expect(allowed.ok).toBe(true)
  })

  it('does not count another folder against the cap', async () => {
    for (let i = 0; i < MAX_FILES_PER_FOLDER; i += 1) {
      seedFile(store, { slug: `file-${i}`, folder: 'values' })
    }

    const result = await writeFile(client, USER, {
      folder: 'networth',
      mode: 'create',
      title: 'Net worth baseline',
      description: 'Where the balance sheet stood in August',
      content: 'Body.',
    })
    expect(result.ok).toBe(true)
  })

  it('requires both a title and a description', async () => {
    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'create',
      title: 'No description',
      content: 'Body.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('title and a one-line description')
  })

  it('rejects an unusable title with no slugifiable characters', async () => {
    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'create',
      title: '!!! ???',
      description: 'Nonsense title',
      content: 'Body.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Could not derive a file name')
  })

  it('rejects an explicitly malformed slug', async () => {
    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'create',
      slug: 'Not A Slug!',
      title: 'Fine title',
      description: 'Fine description',
      content: 'Body.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not valid')
    expect(result.error).toContain('house-deposit-plan')
  })
})

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe('writeFile — validation', () => {
  const valid = {
    folder: 'goals' as const,
    mode: 'create' as const,
    title: 'Fine title',
    description: 'Fine description',
    content: 'Body.',
  }

  it('rejects an over-length title', async () => {
    const result = await writeFile(client, USER, { ...valid, title: 'T'.repeat(81) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Title is 81 characters')
  })

  it('rejects an over-length description', async () => {
    const result = await writeFile(client, USER, { ...valid, description: 'D'.repeat(141) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Description is 141 characters')
  })

  it('rejects over-length content', async () => {
    const result = await writeFile(client, USER, {
      ...valid,
      content: 'c'.repeat(MAX_CONTENT_CHARS + 1),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain(`the limit is ${MAX_CONTENT_CHARS}`)
  })

  it('rejects empty content', async () => {
    const result = await writeFile(client, USER, { ...valid, content: '   \n  ' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Content cannot be empty')
  })

  it('writes nothing when validation fails', async () => {
    await writeFile(client, USER, { ...valid, title: 'T'.repeat(81) })
    expect(store.memory_files).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

describe('writeFile — append', () => {
  const NOW = new Date('2026-08-12T10:30:00.000Z')

  it('adds a dated entry separated by a blank line', async () => {
    seedFile(store, { slug: 'house-deposit-plan', content: 'Original body.' })

    const result = await writeFile(
      client,
      USER,
      {
        folder: 'goals',
        mode: 'append',
        slug: 'house-deposit-plan',
        content: 'Moved the target to 2029.',
      },
      { now: NOW },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toBe(
      'Original body.\n\n— 12 August 2026:\nMoved the target to 2029.',
    )
  })

  it('uses the injected clock, not the wall clock', async () => {
    seedFile(store, { slug: 'plan', content: 'Body.' })

    const result = await writeFile(
      client,
      USER,
      { folder: 'goals', mode: 'append', slug: 'plan', content: 'Later note.' },
      { now: new Date('2027-01-03T00:00:00.000Z') },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toContain('— 3 January 2027:')
  })

  it('records the actor that appended', async () => {
    seedFile(store, { slug: 'plan', content: 'Body.' })

    const result = await writeFile(
      client,
      USER,
      { folder: 'goals', mode: 'append', slug: 'plan', content: 'Digest line.' },
      { now: NOW, actor: 'system' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.updated_by).toBe('system')
    expect(result.value.source).toBe('cfo') // source is who created it, not who touched it
  })

  it('can refresh the index hook while appending', async () => {
    seedFile(store, { slug: 'plan', content: 'Body.', description: 'Old hook' })

    const result = await writeFile(
      client,
      USER,
      {
        folder: 'goals',
        mode: 'append',
        slug: 'plan',
        description: 'New hook',
        content: 'More.',
      },
      { now: NOW },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.description).toBe('New hook')
  })

  it('refuses to append to a file that does not exist', async () => {
    const result = await writeFile(
      client,
      USER,
      { folder: 'goals', mode: 'append', slug: 'nope', content: 'Body.' },
      { now: NOW },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('no file at goals/nope')
    expect(result.error).toContain("mode 'create'")
  })

  it('refuses to overflow the size cap instead of truncating', async () => {
    const original = 'a'.repeat(MAX_CONTENT_CHARS - 20)
    seedFile(store, { slug: 'plan', content: original })

    const result = await writeFile(
      client,
      USER,
      { folder: 'goals', mode: 'append', slug: 'plan', content: 'b'.repeat(200) },
      { now: NOW },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain(`over the ${MAX_CONTENT_CHARS} limit`)
    expect(result.error).toContain("mode 'replace'")
    // Nothing was written, and nothing was silently lost.
    expect(store.memory_files[0].content).toBe(original)
  })

  it('tells the caller to start a new file when the full file is user-edited', async () => {
    seedFile(store, {
      slug: 'plan',
      content: 'a'.repeat(MAX_CONTENT_CHARS - 20),
      user_edited_at: '2026-08-01T00:00:00.000Z',
    })

    const result = await writeFile(
      client,
      USER,
      { folder: 'goals', mode: 'append', slug: 'plan', content: 'b'.repeat(200) },
      { now: NOW },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('start a new file')
    expect(result.error).not.toContain("mode 'replace'")
  })

  it('appends to a user-edited file that still has room', async () => {
    seedFile(store, {
      slug: 'plan',
      content: 'What I actually think.',
      user_edited_at: '2026-08-01T00:00:00.000Z',
    })

    const result = await writeFile(
      client,
      USER,
      { folder: 'goals', mode: 'append', slug: 'plan', content: 'Noted.' },
      { now: NOW },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toContain('What I actually think.')
    expect(result.value.content).toContain('Noted.')
  })
})

// ---------------------------------------------------------------------------
// replace
// ---------------------------------------------------------------------------

describe('writeFile — replace', () => {
  it('REFUSES to replace a file the user has edited', async () => {
    seedFile(store, {
      slug: 'plan',
      content: 'The user wrote this.',
      user_edited_at: '2026-08-01T00:00:00.000Z',
    })

    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'replace',
      slug: 'plan',
      content: 'The CFO would rather say this.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('the user has edited this file')
    expect(result.error).toContain('authoritative')
    expect(result.error).toContain("mode 'append'")
    // The user's words survive, and no revision was manufactured.
    expect(store.memory_files[0].content).toBe('The user wrote this.')
    expect(store.memory_file_revisions).toHaveLength(0)
  })

  it('overwrites the body and stamps the actor', async () => {
    seedFile(store, { slug: 'plan', content: 'Old body.' })

    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'replace',
      slug: 'plan',
      content: 'New body.',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toBe('New body.')
    expect(store.memory_files[0].content).toBe('New body.')
  })

  it('snapshots the PRE-change title, description and content', async () => {
    seedFile(store, {
      slug: 'plan',
      title: 'Old title',
      description: 'Old hook',
      content: 'Old body.',
    })

    await writeFile(client, USER, {
      folder: 'goals',
      mode: 'replace',
      slug: 'plan',
      title: 'New title',
      description: 'New hook',
      content: 'New body.',
    })

    expect(store.memory_file_revisions).toHaveLength(1)
    expect(store.memory_file_revisions[0]).toMatchObject({
      title: 'Old title',
      description: 'Old hook',
      content: 'Old body.',
      superseded_by: 'cfo',
      user_id: USER,
    })
  })

  it('keeps one snapshot per overwrite, oldest first', async () => {
    seedFile(store, { slug: 'plan', content: 'v1' })

    await writeFile(client, USER, { folder: 'goals', mode: 'replace', slug: 'plan', content: 'v2' })
    await writeFile(client, USER, { folder: 'goals', mode: 'replace', slug: 'plan', content: 'v3' })

    expect(store.memory_file_revisions.map((r) => r.content)).toEqual(['v1', 'v2'])
    expect(store.memory_files[0].content).toBe('v3')
  })

  it('prunes history to the newest MAX_REVISIONS_PER_FILE', async () => {
    seedFile(store, { slug: 'plan', content: 'v0' })

    for (let i = 1; i <= 14; i += 1) {
      await writeFile(client, USER, {
        folder: 'goals',
        mode: 'replace',
        slug: 'plan',
        content: `v${i}`,
      })
    }

    const kept = store.memory_file_revisions.map((r) => r.content)
    expect(kept).toHaveLength(10)
    // The newest snapshot is the body the final replace discarded (v13); the
    // oldest surviving one is v4 — v0..v3 were pruned away.
    expect(kept[kept.length - 1]).toBe('v13')
    expect(kept[0]).toBe('v4')
  })

  it('refuses to replace a file that does not exist', async () => {
    const result = await writeFile(client, USER, {
      folder: 'goals',
      mode: 'replace',
      slug: 'nope',
      content: 'Body.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('no file at goals/nope')
  })

  it('leaves the file alone when the snapshot cannot be written', async () => {
    muteConsole()
    seedFile(store, { slug: 'plan', content: 'Old body.' })
    const broken = {
      from: (table: string) =>
        table === 'memory_file_revisions'
          ? { insert: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }
          : (makeClient(store) as unknown as { from: (t: string) => unknown }).from(table),
    } as unknown as SupabaseClient

    const result = await writeFile(broken, USER, {
      folder: 'goals',
      mode: 'replace',
      slug: 'plan',
      content: 'New body.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('left unchanged')
    expect(store.memory_files[0].content).toBe('Old body.')
  })
})

// ---------------------------------------------------------------------------
// reads + archive
// ---------------------------------------------------------------------------

describe('listFolder', () => {
  it('orders pinned first, then most recently updated', async () => {
    seedFile(store, { slug: 'old', updated_at: '2026-08-01T00:00:00.000Z' })
    seedFile(store, { slug: 'recent', updated_at: '2026-08-10T00:00:00.000Z' })
    seedFile(store, { slug: 'pinned-stale', pinned: true, updated_at: '2026-01-01T00:00:00.000Z' })

    const result = await listFolder(client, USER, 'goals')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((f) => f.slug)).toEqual(['pinned-stale', 'recent', 'old'])
  })

  it('excludes archived files and other folders', async () => {
    seedFile(store, { slug: 'active' })
    seedFile(store, { slug: 'archived', archived_at: '2026-08-01T00:00:00.000Z' })
    seedFile(store, { slug: 'elsewhere', folder: 'values' })

    const result = await listFolder(client, USER, 'goals')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((f) => f.slug)).toEqual(['active'])
  })

  it('never returns file bodies', async () => {
    seedFile(store, { slug: 'plan', content: 'A very expensive body.' })

    const result = await listFolder(client, USER, 'goals')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0]).not.toHaveProperty('content')
    expect(result.value[0].title).toBe('Seeded file')
  })

  it('scopes to the requesting user', async () => {
    seedFile(store, { slug: 'mine' })
    seedFile(store, { slug: 'theirs', user_id: 'user-2' })

    const result = await listFolder(client, USER, 'goals')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((f) => f.slug)).toEqual(['mine'])
  })
})

describe('getFile', () => {
  it('returns the body', async () => {
    seedFile(store, { slug: 'plan', content: 'The body.' })

    const result = await getFile(client, USER, 'goals', 'plan')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value?.content).toBe('The body.')
  })

  it('returns null for a missing or archived file', async () => {
    seedFile(store, { slug: 'gone', archived_at: '2026-08-01T00:00:00.000Z' })

    const missing = await getFile(client, USER, 'goals', 'never-existed')
    const archived = await getFile(client, USER, 'goals', 'gone')
    expect(missing.ok && missing.value).toBeNull()
    expect(archived.ok && archived.value).toBeNull()
  })
})

describe('archiveFile', () => {
  it('archives an active file so it drops out of listings', async () => {
    seedFile(store, { slug: 'plan' })

    const result = await archiveFile(client, USER, 'goals', 'plan')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.alreadyArchived).toBe(false)
    expect(store.memory_files[0].archived_at).not.toBeNull()

    const listed = await listFolder(client, USER, 'goals')
    expect(listed.ok && listed.value).toEqual([])
  })

  it('treats an already-archived file as success', async () => {
    seedFile(store, { slug: 'plan', archived_at: '2026-08-01T00:00:00.000Z' })

    const result = await archiveFile(client, USER, 'goals', 'plan')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.alreadyArchived).toBe(true)
  })

  it('errors clearly when there is nothing to archive', async () => {
    const result = await archiveFile(client, USER, 'goals', 'nope')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('no file at goals/nope')
  })
})

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-12T12:00:00.000Z')

function entry(partial: Partial<MemoryIndexEntry> & { slug: string }): MemoryIndexEntry {
  return {
    description: 'A description',
    updated_at: '2026-08-12T09:00:00.000Z',
    pinned: false,
    ...partial,
  }
}

describe('renderMemoryIndex', () => {
  it('always shows all four folders, empty ones included', () => {
    const rendered = renderMemoryIndex({}, NOW)
    expect(rendered).toBe(
      [
        '## Filing cabinet index',
        'Goals:',
        '- (no files yet)',
        'Cash Flow:',
        '- (no files yet)',
        'Values & You:',
        '- (no files yet)',
        'Net Worth:',
        '- (no files yet)',
      ].join('\n'),
    )
  })

  it('renders a file line with its hook and age', () => {
    const rendered = renderMemoryIndex(
      {
        goals: [
          entry({
            slug: 'house-deposit-plan',
            description: 'Saving €40k by 2028; tension with the wedding fund',
            updated_at: '2026-08-09T12:00:00.000Z',
          }),
        ],
      },
      NOW,
    )

    expect(rendered).toContain(
      '- house-deposit-plan — Saving €40k by 2028; tension with the wedding fund (updated 3d ago)',
    )
  })

  it('puts pinned files first, then recency, and marks the pin', () => {
    const rendered = renderMemoryIndex(
      {
        cashflow: [
          entry({ slug: 'stale', updated_at: '2026-08-01T12:00:00.000Z' }),
          entry({ slug: 'fresh', updated_at: '2026-08-12T09:00:00.000Z' }),
          entry({ slug: 'pinned', pinned: true, updated_at: '2026-06-01T12:00:00.000Z' }),
        ],
      },
      NOW,
    )

    const lines = rendered.split('\n')
    const start = lines.indexOf('Cash Flow:')
    expect(lines[start + 1]).toContain('- pinned —')
    expect(lines[start + 1]).toContain('(pinned · updated')
    expect(lines[start + 2]).toContain('- fresh —')
    expect(lines[start + 3]).toContain('- stale —')
  })

  it('renders relative ages deterministically from the injected now', () => {
    const rendered = renderMemoryIndex(
      {
        goals: [
          entry({ slug: 'a', pinned: true, updated_at: '2026-08-12T06:00:00.000Z' }),
          entry({ slug: 'b', updated_at: '2026-08-07T12:00:00.000Z' }),
          entry({ slug: 'c', updated_at: '2026-07-29T12:00:00.000Z' }),
          entry({ slug: 'd', updated_at: '2026-04-12T12:00:00.000Z' }),
        ],
      },
      NOW,
    )

    expect(rendered).toContain('- a — A description (pinned · updated today)')
    expect(rendered).toContain('- b — A description (updated 5d ago)')
    expect(rendered).toContain('- c — A description (updated 2w ago)')
    expect(rendered).toContain('- d — A description (updated 4mo ago)')
  })

  it('caps each folder and adds an overflow line', () => {
    const many = Array.from({ length: INDEX_MAX_LINES_PER_FOLDER + 3 }, (_, i) =>
      entry({ slug: `file-${i}`, updated_at: `2026-08-0${(i % 9) + 1}T12:00:00.000Z` }),
    )

    const rendered = renderMemoryIndex({ values: many }, NOW)
    const lines = rendered.split('\n')
    const start = lines.indexOf('Values & You:')
    const folderLines = lines.slice(start + 1, start + 1 + INDEX_MAX_LINES_PER_FOLDER + 1)

    expect(folderLines).toHaveLength(INDEX_MAX_LINES_PER_FOLDER + 1)
    expect(folderLines[folderLines.length - 1]).toBe(
      '- …and 3 more — list the folder to see them',
    )
  })

  it('stays inside its structural budget however full the cabinet is', () => {
    const stuffed = Array.from({ length: 50 }, (_, i) =>
      entry({ slug: `file-${i}`, description: 'D'.repeat(140) }),
    )
    const rendered = renderMemoryIndex(
      { goals: stuffed, cashflow: stuffed, values: stuffed, networth: stuffed },
      NOW,
    )

    // 1 heading + 4 × (folder label + 6 file lines + 1 overflow line) = 33 lines,
    // and that is the hard ceiling regardless of how many files exist.
    expect(rendered.split('\n')).toHaveLength(33)
  })

  it('keeps a realistically full cabinet inside ~500 tokens', () => {
    // Four folders, four files each, hooks the length a CFO actually writes.
    const files = (prefix: string) =>
      Array.from({ length: 4 }, (_, i) =>
        entry({
          slug: `${prefix}-file-${i}`,
          description: 'A one-line hook of the sort the CFO actually writes here',
        }),
      )
    const rendered = renderMemoryIndex(
      {
        goals: files('goals'),
        cashflow: files('cash'),
        values: files('values'),
        networth: files('net'),
      },
      NOW,
    )

    // ~4 chars per token: 2000 characters is roughly the 500-token budget.
    expect(rendered.length).toBeLessThan(2000)
  })
})

describe('loadMemoryIndex', () => {
  it('groups one query into four folders and renders the index', async () => {
    seedFile(store, {
      slug: 'house-deposit-plan',
      folder: 'goals',
      description: 'Saving €40k by 2028',
      updated_at: '2026-08-12T09:00:00.000Z',
    })
    seedFile(store, {
      slug: 'subscription-creep',
      folder: 'cashflow',
      description: 'Six subscriptions, three unused',
      updated_at: '2026-08-05T09:00:00.000Z',
    })
    seedFile(store, { slug: 'hidden', folder: 'values', archived_at: '2026-08-01T00:00:00.000Z' })

    const fromSpy = vi.spyOn(client, 'from')
    const result = await loadMemoryIndex(client, USER, NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fromSpy).toHaveBeenCalledTimes(1) // one round trip, grouped in TS
    expect(result.value).toContain('- house-deposit-plan — Saving €40k by 2028 (updated today)')
    // 2026-08-05 → 2026-08-12 is exactly 7 days, which relativeAge renders as
    // the first week bucket ("1w ago"), not "7d ago" — the `d ago` form stops
    // at 6. The per-branch assertions live in the renderMemoryIndex suite.
    expect(result.value).toContain('- subscription-creep — Six subscriptions, three unused (updated 1w ago)')
    expect(result.value).toContain('Values & You:\n- (no files yet)')
    expect(result.value).toContain('Net Worth:\n- (no files yet)')
  })

  it('reports a read failure instead of throwing', async () => {
    muteConsole()
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                order: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await loadMemoryIndex(broken, USER, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Could not read the filing cabinet index')
  })
})
