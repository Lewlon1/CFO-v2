// ============================================================
// The Filing Cabinet — data-access layer
// ============================================================
// Read/write access to public.memory_files + public.memory_file_revisions
// (migration 082). The CFO reaches these through tools; the office UI will
// reach them directly in a later phase.
//
// Dependency injection: every function takes a Supabase client as its first
// argument and this module NEVER creates one. The chat tools pass a
// user-authenticated client so RLS is the real boundary; background jobs pass a
// service client.
//
// Errors are returned, not thrown: `{ ok: false, error }`. The error strings are
// read by an LLM mid-turn, so they say what went wrong AND what to do instead —
// a Postgres constraint violation is useless to the model. Unexpected DB errors
// are logged with `[memory:…]` and reduced to a short, safe message.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  INDEX_MAX_LINES_PER_FOLDER,
  MAX_CONTENT_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_FILES_PER_FOLDER,
  MAX_REVISIONS_PER_FILE,
  MAX_SLUG_CHARS,
  MAX_TITLE_CHARS,
  MEMORY_FOLDERS,
  MEMORY_FOLDER_LABELS,
  type MemoryFolder,
} from './constants'

// ── Types ──────────────────────────────────────────────────────────────────

/** Matches the `memory_actor` Postgres enum. */
export type MemoryActor = 'cfo' | 'system' | 'user'

export type MemoryResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** The light shape: everything the index and folder listings need, no body. */
export interface MemoryFileSummary {
  slug: string
  title: string
  description: string
  updated_at: string
  pinned: boolean
  source: MemoryActor
  updated_by: MemoryActor
  user_edited_at: string | null
}

/** The full row, body included. Only `getFile` and writes return this. */
export interface MemoryFile extends MemoryFileSummary {
  id: string
  folder: MemoryFolder
  content: string
  created_at: string
  archived_at: string | null
}

export type MemoryWriteMode = 'create' | 'append' | 'replace'

export interface WriteMemoryFileArgs {
  folder: MemoryFolder
  mode: MemoryWriteMode
  /** Required for append/replace. On create, derived from `title` when omitted. */
  slug?: string
  /** Required on create; optional on append/replace (updates the stored title). */
  title?: string
  /** Required on create; optional on append/replace (updates the index hook). */
  description?: string
  content: string
}

export interface MemoryWriteOptions {
  /** Who is writing. Defaults to the CFO; scheduled digests pass 'system'. */
  actor?: MemoryActor
  /** Injected clock — append stamps a dated entry, so this must be testable. */
  now?: Date
}

/** The minimum a file needs to earn a line in the prompt index. */
export type MemoryIndexEntry = Pick<
  MemoryFileSummary,
  'slug' | 'description' | 'updated_at' | 'pinned'
>

// ── Column sets ────────────────────────────────────────────────────────────

const SUMMARY_COLUMNS =
  'slug, title, description, updated_at, pinned, source, updated_by, user_edited_at'
const FULL_COLUMNS = `id, folder, content, created_at, archived_at, ${SUMMARY_COLUMNS}`

// ── Slug + validation ──────────────────────────────────────────────────────

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Title → slug. Lowercase, accents stripped, every run of non-alphanumerics
 * collapsed to a single hyphen, hyphens trimmed, truncated to MAX_SLUG_CHARS
 * without leaving a trailing hyphen. Returns '' when nothing survives — callers
 * must treat that as a validation failure.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return base.slice(0, MAX_SLUG_CHARS).replace(/-+$/, '')
}

function path(folder: MemoryFolder, slug: string): string {
  return `${folder}/${slug}`
}

/** Returns an LLM-readable error message, or null when the field is fine. */
function checkText(
  label: string,
  value: string,
  max: number,
): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return `${label} cannot be empty.`
  if (trimmed.length > max) {
    return `${label} is ${trimmed.length} characters — the limit is ${max}. Shorten it.`
  }
  return null
}

function checkSlug(slug: string): string | null {
  if (slug.length === 0) {
    return 'Could not derive a file name. Give the file a title made of letters or numbers, or pass an explicit slug.'
  }
  if (slug.length > MAX_SLUG_CHARS) {
    return `The file name "${slug}" is ${slug.length} characters — the limit is ${MAX_SLUG_CHARS}.`
  }
  if (!SLUG_PATTERN.test(slug)) {
    return `The file name "${slug}" is not valid. Use lowercase letters, numbers and single hyphens, e.g. "house-deposit-plan".`
  }
  return null
}

// ── Reads ──────────────────────────────────────────────────────────────────

/**
 * Every active file in a folder — pinned first, then most recently updated.
 * Deliberately excludes `content`: the whole point of the cabinet is not paying
 * for bodies until the CFO asks for one.
 */
export async function listFolder(
  client: SupabaseClient,
  userId: string,
  folder: MemoryFolder,
): Promise<MemoryResult<MemoryFileSummary[]>> {
  const { data, error } = await client
    .from('memory_files')
    .select(SUMMARY_COLUMNS)
    .eq('user_id', userId)
    .eq('folder', folder)
    .is('archived_at', null)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[memory:listFolder] query failed:', error)
    return { ok: false, error: `Could not read the ${folder} folder.` }
  }

  return { ok: true, value: (data ?? []) as unknown as MemoryFileSummary[] }
}

/** One active file, body included. `null` when there is no such file. */
export async function getFile(
  client: SupabaseClient,
  userId: string,
  folder: MemoryFolder,
  slug: string,
): Promise<MemoryResult<MemoryFile | null>> {
  const { data, error } = await client
    .from('memory_files')
    .select(FULL_COLUMNS)
    .eq('user_id', userId)
    .eq('folder', folder)
    .eq('slug', slug)
    .is('archived_at', null)
    .maybeSingle()

  if (error) {
    console.error('[memory:getFile] query failed:', error)
    return { ok: false, error: `Could not read ${path(folder, slug)}.` }
  }

  return { ok: true, value: (data ?? null) as unknown as MemoryFile | null }
}

// ── Write ──────────────────────────────────────────────────────────────────

/**
 * Create, append to, or replace a memory file.
 *
 * - create  — new file. Requires title + description; slug derived from the
 *             title when omitted. Refuses to shadow an existing slug and
 *             refuses once the folder holds MAX_FILES_PER_FOLDER active files.
 * - append  — adds a dated entry to an existing file. Never truncates: if the
 *             result would blow the size cap it fails and says so.
 * - replace — rewrites an existing file, snapshotting the PRE-change state into
 *             memory_file_revisions first. REFUSED once the user has edited the
 *             file: their words are authoritative.
 */
export async function writeFile(
  client: SupabaseClient,
  userId: string,
  args: WriteMemoryFileArgs,
  options: MemoryWriteOptions = {},
): Promise<MemoryResult<MemoryFile>> {
  const actor: MemoryActor = options.actor ?? 'cfo'
  const now = options.now ?? new Date()

  const contentError = checkText('Content', args.content, MAX_CONTENT_CHARS)
  if (contentError) return { ok: false, error: contentError }
  const content = args.content.trim()

  const title = args.title?.trim()
  if (title !== undefined) {
    const titleError = checkText('Title', title, MAX_TITLE_CHARS)
    if (titleError) return { ok: false, error: titleError }
  }

  const description = args.description?.trim()
  if (description !== undefined) {
    const descriptionError = checkText('Description', description, MAX_DESCRIPTION_CHARS)
    if (descriptionError) return { ok: false, error: descriptionError }
  }

  if (args.mode === 'create') {
    return createFile(client, userId, args.folder, {
      slug: args.slug?.trim() ?? '',
      title,
      description,
      content,
      actor,
    })
  }

  const slug = args.slug?.trim() ?? ''
  const slugError = checkSlug(slug)
  if (slugError) return { ok: false, error: slugError }

  const existing = await getFile(client, userId, args.folder, slug)
  if (!existing.ok) return existing
  if (!existing.value) {
    return {
      ok: false,
      error: `There is no file at ${path(args.folder, slug)}. List the folder to see what exists, or use mode 'create' to start it.`,
    }
  }

  return args.mode === 'append'
    ? appendToFile(client, existing.value, { content, title, description, actor, now })
    : replaceFile(client, userId, existing.value, { content, title, description, actor })
}

async function createFile(
  client: SupabaseClient,
  userId: string,
  folder: MemoryFolder,
  input: {
    slug: string
    title?: string
    description?: string
    content: string
    actor: MemoryActor
  },
): Promise<MemoryResult<MemoryFile>> {
  if (!input.title || !input.description) {
    return {
      ok: false,
      error: 'Creating a file needs both a title and a one-line description (the description is what you will see in the index later, so make it earn a re-read).',
    }
  }

  const slug = input.slug.length > 0 ? input.slug : slugify(input.title)
  const slugError = checkSlug(slug)
  if (slugError) return { ok: false, error: slugError }

  // One query covers both guards: the slug collision (which is against ALL
  // files, archived included, because the unique index does not exclude them)
  // and the per-folder cap (active files only).
  const { data: siblings, error: siblingsError } = await client
    .from('memory_files')
    .select('slug, archived_at')
    .eq('user_id', userId)
    .eq('folder', folder)

  if (siblingsError) {
    console.error('[memory:createFile] sibling lookup failed:', siblingsError)
    return { ok: false, error: `Could not read the ${folder} folder.` }
  }

  const rows = (siblings ?? []) as unknown as Array<{ slug: string; archived_at: string | null }>
  const collision = rows.find((row) => row.slug === slug)
  if (collision) {
    return collision.archived_at
      ? {
          ok: false,
          error: `An archived file already occupies ${path(folder, slug)}. Give this one a different title.`,
        }
      : {
          ok: false,
          error: `${path(folder, slug)} already exists. Use mode 'append' to add to it, or mode 'replace' to rewrite it.`,
        }
  }

  const activeCount = rows.filter((row) => row.archived_at === null).length
  if (activeCount >= MAX_FILES_PER_FOLDER) {
    return {
      ok: false,
      error: `The ${folder} folder is full (${MAX_FILES_PER_FOLDER} files). Append this to an existing file, or archive one you no longer need.`,
    }
  }

  const { data, error } = await client
    .from('memory_files')
    .insert({
      user_id: userId,
      folder,
      slug,
      title: input.title,
      description: input.description,
      content: input.content,
      source: input.actor,
      updated_by: input.actor,
    })
    .select(FULL_COLUMNS)
    .single()

  if (error) {
    // 23505 = unique violation: another write won the race between our sibling
    // lookup and this insert.
    if (error.code === '23505') {
      return {
        ok: false,
        error: `${path(folder, slug)} already exists. Use mode 'append' to add to it, or mode 'replace' to rewrite it.`,
      }
    }
    console.error('[memory:createFile] insert failed:', error)
    return { ok: false, error: `Could not create ${path(folder, slug)}.` }
  }

  return { ok: true, value: data as unknown as MemoryFile }
}

/** "12 August 2026" — the header of an appended entry. */
function formatEntryDate(now: Date): string {
  return now.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

async function appendToFile(
  client: SupabaseClient,
  file: MemoryFile,
  input: {
    content: string
    title?: string
    description?: string
    actor: MemoryActor
    now: Date
  },
): Promise<MemoryResult<MemoryFile>> {
  const nextContent = `${file.content.trimEnd()}\n\n— ${formatEntryDate(input.now)}:\n${input.content}`

  if (nextContent.length > MAX_CONTENT_CHARS) {
    // Never silently truncate — losing the tail of someone's financial history
    // without telling anyone is worse than failing loudly.
    const escape = file.user_edited_at
      ? 'The user has edited this file, so it cannot be rewritten — start a new file for this instead.'
      : "Read the file and rewrite it with mode 'replace', consolidating the older entries."
    return {
      ok: false,
      error: `Appending would take ${path(file.folder, file.slug)} to ${nextContent.length} characters, over the ${MAX_CONTENT_CHARS} limit. ${escape}`,
    }
  }

  const { data, error } = await client
    .from('memory_files')
    .update({
      content: nextContent,
      updated_by: input.actor,
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
    })
    .eq('id', file.id)
    .select(FULL_COLUMNS)
    .single()

  if (error) {
    console.error('[memory:appendToFile] update failed:', error)
    return { ok: false, error: `Could not append to ${path(file.folder, file.slug)}.` }
  }

  return { ok: true, value: data as unknown as MemoryFile }
}

async function replaceFile(
  client: SupabaseClient,
  userId: string,
  file: MemoryFile,
  input: {
    content: string
    title?: string
    description?: string
    actor: MemoryActor
  },
): Promise<MemoryResult<MemoryFile>> {
  // The trust guarantee. The cabinet is visible to the user and editable by
  // them; once they have written in it, the CFO adds to it and never overwrites.
  if (file.user_edited_at) {
    return {
      ok: false,
      error: `You cannot replace ${path(file.folder, file.slug)} — the user has edited this file and their words are authoritative. Use mode 'append' to add to it instead.`,
    }
  }

  // Snapshot BEFORE the overwrite, so the row we keep is the state the write
  // discards. (Snapshot-first also means a failed update leaves a harmless
  // duplicate of the current content, rather than losing it entirely.)
  const { error: revisionError } = await client
    .from('memory_file_revisions')
    .insert({
      file_id: file.id,
      user_id: userId,
      title: file.title,
      description: file.description,
      content: file.content,
      superseded_by: input.actor,
    })

  if (revisionError) {
    console.error('[memory:replaceFile] revision insert failed:', revisionError)
    return {
      ok: false,
      error: `Could not save the previous version of ${path(file.folder, file.slug)}, so it was left unchanged.`,
    }
  }

  const { data, error } = await client
    .from('memory_files')
    .update({
      content: input.content,
      updated_by: input.actor,
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
    })
    .eq('id', file.id)
    .select(FULL_COLUMNS)
    .single()

  if (error) {
    console.error('[memory:replaceFile] update failed:', error)
    return { ok: false, error: `Could not rewrite ${path(file.folder, file.slug)}.` }
  }

  await pruneRevisions(client, file.id)

  return { ok: true, value: data as unknown as MemoryFile }
}

/**
 * Keep only the newest MAX_REVISIONS_PER_FILE snapshots for a file. Best-effort:
 * the content write has already succeeded by the time this runs, so a failure is
 * logged and swallowed rather than reported as a failed write.
 */
async function pruneRevisions(client: SupabaseClient, fileId: string): Promise<void> {
  const { data, error } = await client
    .from('memory_file_revisions')
    .select('id')
    .eq('file_id', fileId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[memory:pruneRevisions] lookup failed:', error)
    return
  }

  const rows = (data ?? []) as unknown as Array<{ id: string }>
  const stale = rows.slice(MAX_REVISIONS_PER_FILE).map((row) => row.id)
  if (stale.length === 0) return

  const { error: deleteError } = await client
    .from('memory_file_revisions')
    .delete()
    .in('id', stale)

  if (deleteError) {
    console.error('[memory:pruneRevisions] delete failed:', deleteError)
  }
}

// ── Archive ────────────────────────────────────────────────────────────────

/**
 * Soft-archive a file: it drops out of listings, the prompt index and the
 * per-folder cap, but survives for export and for the user to restore. Already
 * archived is success, not an error; genuinely absent is an error.
 */
export async function archiveFile(
  client: SupabaseClient,
  userId: string,
  folder: MemoryFolder,
  slug: string,
): Promise<MemoryResult<{ folder: MemoryFolder; slug: string; alreadyArchived: boolean }>> {
  const { data, error } = await client
    .from('memory_files')
    .update({ archived_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('folder', folder)
    .eq('slug', slug)
    .is('archived_at', null)
    .select('slug')
    .maybeSingle()

  if (error) {
    console.error('[memory:archiveFile] update failed:', error)
    return { ok: false, error: `Could not archive ${path(folder, slug)}.` }
  }

  if (data) return { ok: true, value: { folder, slug, alreadyArchived: false } }

  // Nothing active matched — either it was already archived, or it never existed.
  const { data: existingRow, error: lookupError } = await client
    .from('memory_files')
    .select('slug')
    .eq('user_id', userId)
    .eq('folder', folder)
    .eq('slug', slug)
    .maybeSingle()

  if (lookupError) {
    console.error('[memory:archiveFile] lookup failed:', lookupError)
    return { ok: false, error: `Could not archive ${path(folder, slug)}.` }
  }

  if (existingRow) return { ok: true, value: { folder, slug, alreadyArchived: true } }

  return {
    ok: false,
    error: `There is no file at ${path(folder, slug)}. List the folder to see what exists.`,
  }
}

// ── Index ──────────────────────────────────────────────────────────────────

/**
 * "today" / "5d ago" / "3w ago" / "4mo ago". Deterministic: the caller supplies
 * `now`, because this string ends up in a prompt and in test assertions.
 */
function relativeAge(iso: string, now: Date): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'unknown'

  const days = Math.floor((now.getTime() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days < 7) return `${days}d ago`
  if (days < 56) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

function byPinnedThenRecent(a: MemoryIndexEntry, b: MemoryIndexEntry): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
}

/**
 * The compact index injected into the system prompt — one line per file, all
 * four folders always present. Pure: no I/O, no clock of its own. Budget is
 * roughly 500 tokens, which is what INDEX_MAX_LINES_PER_FOLDER buys.
 */
export function renderMemoryIndex(
  filesByFolder: Partial<Record<MemoryFolder, MemoryIndexEntry[]>>,
  now: Date,
): string {
  const lines: string[] = ['## Filing cabinet index']

  for (const folder of MEMORY_FOLDERS) {
    lines.push(`${MEMORY_FOLDER_LABELS[folder]}:`)

    const files = [...(filesByFolder[folder] ?? [])].sort(byPinnedThenRecent)
    if (files.length === 0) {
      lines.push('- (no files yet)')
      continue
    }

    for (const file of files.slice(0, INDEX_MAX_LINES_PER_FOLDER)) {
      const age = relativeAge(file.updated_at, now)
      const meta = file.pinned ? `pinned · updated ${age}` : `updated ${age}`
      lines.push(`- ${file.slug} — ${file.description} (${meta})`)
    }

    const overflow = files.length - INDEX_MAX_LINES_PER_FOLDER
    if (overflow > 0) {
      lines.push(`- …and ${overflow} more — list the folder to see them`)
    }
  }

  return lines.join('\n')
}

/**
 * Fetch every active file for a user in ONE query and render the prompt index.
 * Grouping happens in TS — four round trips for four folders would be silly.
 */
export async function loadMemoryIndex(
  client: SupabaseClient,
  userId: string,
  now: Date,
): Promise<MemoryResult<string>> {
  const { data, error } = await client
    .from('memory_files')
    .select('folder, slug, description, updated_at, pinned')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[memory:loadMemoryIndex] query failed:', error)
    return { ok: false, error: 'Could not read the filing cabinet index.' }
  }

  const rows = (data ?? []) as unknown as Array<MemoryIndexEntry & { folder: MemoryFolder }>
  const grouped: Partial<Record<MemoryFolder, MemoryIndexEntry[]>> = {}
  for (const row of rows) {
    const bucket = grouped[row.folder] ?? (grouped[row.folder] = [])
    bucket.push(row)
  }

  return { ok: true, value: renderMemoryIndex(grouped, now) }
}
