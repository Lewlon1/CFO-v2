// ============================================================
// The Filing Cabinet — filing the CFO's composed documents
// ============================================================
// A Read is the longest, most considered thing the CFO ever writes, and until
// now it lived only as a message inside one conversation — findable by scrolling
// back through a chat, and invisible to the CFO's own memory afterwards.
//
// Filing it puts it where the user already looks (Values & You) and where the
// CFO can read it back before repeating itself.
//
// The one rule this module lives by: filing must NEVER break delivery. Every
// path returns void and swallows its errors into a log line. A user whose Read
// failed to file still gets their Read.

import type { SupabaseClient } from '@supabase/supabase-js'
import { writeFile, getFile } from './files'

/** Which composition produced this text. */
export type ComposedReadVariant = 'first_read' | 'value_first_recompose' | 'declared_upgrade'

/** The single document all Reads land in. */
const READ_FOLDER = 'values' as const
const READ_SLUG = 'first-read'
const READ_TITLE = 'Your first read'
const READ_DESCRIPTION =
  'The read your CFO wrote the first time it saw your money, and every rewrite since.'

/**
 * How a rewrite introduces itself inside the document. The first Read needs no
 * heading — it IS the document — but a rewrite has to say why it exists, or the
 * user is left reading two Reads with no idea what changed between them.
 */
const REWRITE_HEADINGS: Record<ComposedReadVariant, string | null> = {
  first_read: null,
  value_first_recompose: '**Rewritten after your Value Map**',
  declared_upgrade: '**Rewritten against your real statement**',
}

/** Chips are a chat affordance. In a filed document they are just noise. */
const OPTIONS_BLOCK = /\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/gi

/**
 * File a composed Read as a document in Values & You.
 *
 * First Read creates the file; a recompose or a declared→actual upgrade appends
 * a dated entry to it, so the user keeps the version they originally read rather
 * than watching it be silently replaced. Appending also works after the user has
 * edited the document — the CFO's replace path is refused there, by design.
 */
export async function fileComposedRead(
  client: SupabaseClient,
  userId: string,
  input: { content: string; variant: ComposedReadVariant },
): Promise<void> {
  const body = input.content.replace(OPTIONS_BLOCK, '').trim()
  if (!body) return

  try {
    const existing = await getFile(client, userId, READ_FOLDER, READ_SLUG)
    if (!existing.ok) {
      console.error('[memory:fileComposedRead] lookup failed:', existing.error)
      return
    }

    const heading = REWRITE_HEADINGS[input.variant]
    const result = existing.value
      ? await writeFile(
          client,
          userId,
          {
            folder: READ_FOLDER,
            slug: READ_SLUG,
            mode: 'append',
            content: heading ? `${heading}\n\n${body}` : body,
          },
          { actor: 'system' },
        )
      : await writeFile(
          client,
          userId,
          {
            folder: READ_FOLDER,
            slug: READ_SLUG,
            mode: 'create',
            title: READ_TITLE,
            description: READ_DESCRIPTION,
            content: heading ? `${heading}\n\n${body}` : body,
          },
          { actor: 'system' },
        )

    if (!result.ok) {
      // Expected-and-fine failures live here too: the user archived the document,
      // or a long Read pushed it past the size cap. Neither is worth an alert.
      console.warn(`[memory:fileComposedRead] not filed (${input.variant}): ${result.error}`)
    }
  } catch (err) {
    console.error('[memory:fileComposedRead] unexpected failure:', err)
  }
}
