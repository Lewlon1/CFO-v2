// ============================================================
// The Filing Cabinet — portrait digests
// ============================================================
// `financial_portrait` stays the machine store: one row per trait, with
// confidence, evidence and dismissal. It feeds the portrait UI and the
// extraction dedup, and none of that changes here.
//
// What changes is what the PROMPT sees. Every non-dismissed trait used to be
// injected verbatim on every turn, unbounded — a user with sixty traits paid for
// sixty traits per message. Instead, the traits are rendered down to one file
// per folder, `patterns`, which the CFO reads on demand like any other file and
// the user can open like any other file.
//
// The derivation is ONE-WAY and deterministic — no LLM, no arithmetic, no
// clock-dependent text beyond the dated delta headers. `financial_portrait` is
// the source; the file is a view of it.
//
// Except once the user edits the file. Then it is theirs: the digest is never
// rewritten again, and new observations arrive as dated entries appended below
// a divider. That is the same trust guarantee the write tool enforces, applied
// to the one file the system writes on its own.

import type { SupabaseClient } from '@supabase/supabase-js'
import { MEMORY_FOLDERS, type MemoryFolder } from './constants'
import { getFile, setFileFlags, writeFile } from './files'

/** Below this, a trait is a guess. Guesses do not belong in a file. */
const MIN_CONFIDENCE = 0.6

/** One digest per folder. */
const DIGEST_SLUG = 'patterns'
const DIGEST_TITLE = 'The pattern so far'

const DIGEST_DESCRIPTIONS: Record<MemoryFolder, string> = {
  goals: 'What your goals have shown about how you commit and follow through.',
  cashflow: 'How you actually run your month — the shape your spending keeps.',
  values: 'What you value, how you behave, and where the two part ways.',
  // Net Worth never renders a digest — see TRAIT_GROUPS. Present so the record
  // stays total and adding a mapping later needs no second edit.
  networth: 'What you hold, and the shape of it.',
}

/**
 * Trait types, grouped under the heading the user reads.
 *
 * Three types are deliberately absent, and the third is the interesting one.
 *
 * `archetype` duplicates the Value Map archetype, which stays injected directly
 * from `value_map_sessions` — filing it too would have the CFO reading the same
 * sentence twice. `follow_up_suggestion` is queue machinery, not something true
 * about the user.
 *
 * `asset_profile` is excluded despite the plan mapping it to Net Worth, because
 * its rows are not prose: `computeTraits` in balance-sheet/portrait.ts writes
 * flags — `has_pension: "yes"`, `net_worth_bracket: "under_10k"`,
 * `asset_allocation_summary: "stocks: 60%, cash: 40%"`. Rendered as bullets they
 * would read "- yes / - no / - under_10k". They are also exactly what the
 * cabinet is not for: figures a structured tool owns (`get_balance_sheet`) and
 * numbers presented as current. So Net Worth has no digest, by design.
 */
const TRAIT_GROUPS: ReadonlyArray<{
  folder: MemoryFolder
  traitTypes: readonly string[]
  heading: string
}> = [
  { folder: 'values', traitTypes: ['behavioral'], heading: 'How you behave with money' },
  { folder: 'values', traitTypes: ['personality'], heading: 'How you think about money' },
  { folder: 'values', traitTypes: ['value_preference'], heading: 'What you value' },
  {
    folder: 'values',
    traitTypes: ['gap_analysis', 'gap_invitation', 'gap_coverage'],
    heading: 'Where intention and spending part ways',
  },
  { folder: 'cashflow', traitTypes: ['financial_style'], heading: 'How you run your month' },
]

/** The heading goal-flavoured traits land under, whatever their type. */
const GOALS_HEADING = 'On your goals'

/**
 * Traits about a goal are typed by their flavour (`behavioral`, `personality`),
 * not by their subject, so the folder has to be read off the key. Deliberately
 * narrow: a key must be ABOUT a goal, not merely mention one.
 */
const GOAL_KEY_PATTERN = /(^|_)goals?($|_)/

export interface PortraitTrait {
  trait_type: string
  trait_key: string
  trait_value: string
  confidence: number | null
  updated_at?: string | null
  created_at?: string | null
}

/** Which folder a trait's line belongs in, or null if it is not filed at all. */
function folderFor(trait: PortraitTrait): MemoryFolder | null {
  if (GOAL_KEY_PATTERN.test(trait.trait_key)) return 'goals'
  return TRAIT_GROUPS.find((g) => g.traitTypes.includes(trait.trait_type))?.folder ?? null
}

function headingFor(trait: PortraitTrait): string {
  if (GOAL_KEY_PATTERN.test(trait.trait_key)) return GOALS_HEADING
  return TRAIT_GROUPS.find((g) => g.traitTypes.includes(trait.trait_type))?.heading ?? ''
}

/** Trim to one clean sentence-ish line — the store holds prose of varying tidiness. */
function toLine(trait: PortraitTrait): string {
  return trait.trait_value.trim().replace(/\s+/g, ' ')
}

/**
 * Render one folder's digest body.
 *
 * Pure and order-stable: traits are grouped by heading in the fixed order above
 * and sorted by confidence then key inside each group, so the same portrait
 * always produces byte-identical text. That matters — an unstable render would
 * rewrite the file (and bust the prompt cache) on every portrait write.
 *
 * Returns '' when the folder has nothing worth filing.
 */
export function renderDigest(folder: MemoryFolder, traits: PortraitTrait[]): string {
  const eligible = traits
    .filter((t) => (t.confidence ?? 0) >= MIN_CONFIDENCE)
    .filter((t) => folderFor(t) === folder)
    .filter((t) => t.trait_value?.trim())

  if (eligible.length === 0) return ''

  const headings = [
    ...TRAIT_GROUPS.filter((g) => g.folder === folder).map((g) => g.heading),
    ...(folder === 'goals' ? [GOALS_HEADING] : []),
  ]

  const sections: string[] = []
  for (const heading of headings) {
    const lines = eligible
      .filter((t) => headingFor(t) === heading)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.trait_key.localeCompare(b.trait_key))
      .map((t) => `- ${toLine(t)}`)

    if (lines.length > 0) sections.push([`**${heading}**`, ...lines].join('\n'))
  }

  if (sections.length === 0) return ''

  return [
    'Assembled from your own numbers and what you have said. It keeps itself current.',
    '',
    sections.join('\n\n'),
  ].join('\n')
}

interface RefreshOptions {
  now?: Date
  /** Dismiss path only — see `recordTraitDismissal`. Scoped to one folder. */
  retraction?: { folder: MemoryFolder; text: string }
}

/**
 * Bring every folder's digest back in line with the portrait.
 *
 * Called after anything that writes a trait. Never throws and never reports: it
 * is a hook on somebody else's write path, and a stale digest is not worth
 * failing a portrait extraction over.
 */
export async function refreshMemoryDigests(
  client: SupabaseClient,
  userId: string,
  options: { now?: Date } = {},
): Promise<void> {
  await refresh(client, userId, options)
}

/**
 * The dismiss path. On an unfrozen digest this is just a regenerate — the trait
 * is gone from the portrait, so it is gone from the render. On a digest the user
 * has taken over, the regenerate cannot run, so the dismissal has to arrive as a
 * line of its own; otherwise the file goes on asserting something the user has
 * explicitly struck out.
 */
export async function recordTraitDismissal(
  client: SupabaseClient,
  userId: string,
  trait: PortraitTrait,
  options: { now?: Date } = {},
): Promise<void> {
  const folder = folderFor(trait)
  await refresh(client, userId, {
    ...options,
    retraction: folder
      ? { folder, text: ['**Struck out**', `- ${toLine(trait)}`].join('\n') }
      : undefined,
  })
}

async function refresh(
  client: SupabaseClient,
  userId: string,
  options: RefreshOptions,
): Promise<void> {
  try {
    const { data, error } = await client
      .from('financial_portrait')
      .select('trait_type, trait_key, trait_value, confidence, updated_at, created_at')
      .eq('user_id', userId)
      .is('dismissed_at', null)

    if (error) {
      console.error('[memory:digests] portrait read failed:', error)
      return
    }

    const traits = (data ?? []) as unknown as PortraitTrait[]

    for (const folder of MEMORY_FOLDERS) {
      await refreshOne(client, userId, folder, traits, options)
    }
  } catch (err) {
    console.error('[memory:digests] unexpected failure:', err)
  }
}

async function refreshOne(
  client: SupabaseClient,
  userId: string,
  folder: MemoryFolder,
  traits: PortraitTrait[],
  options: RefreshOptions,
): Promise<void> {
  const body = renderDigest(folder, traits)
  const existing = await getFile(client, userId, folder, DIGEST_SLUG)
  if (!existing.ok) return

  const file = existing.value

  if (!file) {
    // Nothing filed and nothing to file — a new user pays nothing for this.
    if (!body) return

    const created = await writeFile(
      client,
      userId,
      {
        folder,
        slug: DIGEST_SLUG,
        mode: 'create',
        title: DIGEST_TITLE,
        description: DIGEST_DESCRIPTIONS[folder],
        content: body,
      },
      { actor: 'system', now: options.now },
    )
    if (!created.ok) {
      console.warn(`[memory:digests] could not create ${folder}/${DIGEST_SLUG}: ${created.error}`)
      return
    }

    // Pinned, so it holds the top of its folder's index line-budget. This is the
    // one file in a folder the CFO should reach for before it guesses.
    await setFileFlags(client, userId, created.value.id, { pinned: true })
    return
  }

  if (file.user_edited_at) {
    // Frozen. The user's words stand; anything new arrives as a dated entry
    // below them — the divider `append` already writes — and only when there is
    // genuinely something to say.
    const retraction =
      options.retraction?.folder === folder ? options.retraction.text : null
    const delta = retraction ?? deltaSince(folder, traits, file.updated_at)
    if (!delta) return

    const appended = await writeFile(
      client,
      userId,
      { folder, slug: DIGEST_SLUG, mode: 'append', content: delta },
      { actor: 'system', now: options.now },
    )
    if (!appended.ok) console.warn(`[memory:digests] could not append to ${folder}/${DIGEST_SLUG}: ${appended.error}`)
    return
  }

  // Not frozen: the file is a view of the portrait, so re-render it wholesale.
  // Identical output is the common case — skip the write so the row's
  // updated_at (and the prompt index line that reads it) stays honest.
  if (body === file.content) return

  if (!body) {
    // Every trait behind this digest is gone. Leave the file rather than
    // deleting it: the user may be reading it, and archiving is their call.
    return
  }

  const replaced = await writeFile(
    client,
    userId,
    { folder, slug: DIGEST_SLUG, mode: 'replace', content: body },
    { actor: 'system', now: options.now },
  )
  if (!replaced.ok) console.warn(`[memory:digests] could not rewrite ${folder}/${DIGEST_SLUG}: ${replaced.error}`)
}

/**
 * What has landed in this folder since the frozen file was last touched.
 * Deliberately additive-only — a frozen file never loses a line, so this reports
 * arrivals, never departures. Departures come through as an explicit retraction.
 */
function deltaSince(folder: MemoryFolder, traits: PortraitTrait[], since: string): string | null {
  const cutoff = new Date(since).getTime()
  if (!Number.isFinite(cutoff)) return null

  const fresh = traits
    .filter((t) => (t.confidence ?? 0) >= MIN_CONFIDENCE)
    .filter((t) => folderFor(t) === folder)
    .filter((t) => t.trait_value?.trim())
    .filter((t) => {
      const stamp = new Date(t.updated_at ?? t.created_at ?? '').getTime()
      return Number.isFinite(stamp) && stamp > cutoff
    })
    .sort((a, b) => a.trait_key.localeCompare(b.trait_key))

  if (fresh.length === 0) return null

  return ['**Since you edited this**', ...fresh.map((t) => `- ${toLine(t)}`)].join('\n')
}
