import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared building blocks for first-read FOLLOW-UP composition.
 *
 * A "follow-up" appends a NEW assistant message into an EXISTING layered
 * `first_read` conversation (rather than starting a fresh thread) and refreshes
 * the conversation's freeform `metadata` snapshot. Two routes need this:
 *
 *   - recompose-first-read  → delta Read after the Value Map (mode value_first_recompose)
 *   - upgrade-declared-read  → sharper transaction Read after a declared-mode upload
 *
 * Behaviour here is extracted VERBATIM from those routes / post-upload — no new
 * semantics. Schema gotchas baked in:
 *   - `messages` has NO `updated_at` column. Never set it on insert (PostgREST
 *     schema-cache error).
 *   - `conversations` DOES have `updated_at`; bump it on every metadata write.
 *   - Assistant-role inserts go through the SERVICE client (RLS may reject a
 *     user-session insert with role='assistant').
 */

// The Supabase JS client is generic over the DB schema; this module touches
// freeform jsonb and RPCs, so an untyped client keeps the helper reusable across
// the anon (server) and service clients without coupling to generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>

/** A layered first_read conversation row, narrowed to what follow-ups need. */
export type LayeredFirstRead = {
  id: string
  metadata: Record<string, unknown> | null
}

/**
 * Find the newest layered `first_read` conversation for a user, or null.
 *
 * Filters match the existing routes exactly: `type='first_read'` +
 * `metadata->>layered_read='true'`, newest by `created_at`. (post-upload marks
 * stale typed conversations completed before composing, so the newest layered
 * row is the active one.)
 */
export async function findLayeredFirstRead(
  supabase: AnySupabase,
  userId: string,
): Promise<LayeredFirstRead | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('type', 'first_read')
    .eq('metadata->>layered_read', 'true')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id as string,
    metadata: (data.metadata as Record<string, unknown> | null) ?? null,
  }
}

export type AppendAssistantFollowupArgs = {
  conversationId: string
  userId: string
  content: string
}

export type AppendResult = { id: string | null }

/**
 * Append an assistant message to an existing conversation.
 *
 * Mirrors the inserts in recompose-first-read / post-upload: service client,
 * role='assistant', and crucially NO `updated_at` (the column doesn't exist on
 * `messages`). Returns the inserted row id when the DB returns it.
 *
 * Throws on insert error so callers can surface a 500 — matches the routes,
 * which check `error` and bail.
 */
export async function appendAssistantFollowup(
  svc: AnySupabase,
  { conversationId, userId, content }: AppendAssistantFollowupArgs,
): Promise<AppendResult> {
  const { data, error } = await svc
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'assistant',
      content,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(`appendAssistantFollowup: message insert failed: ${error.message}`)
  }

  return { id: (data?.id as string | undefined) ?? null }
}

export type SnapshotConversationMetadataArgs = {
  conversationId: string
  /** Patch merged on top of the row's current metadata (spread prev + patch). */
  metadata: Record<string, unknown>
}

/**
 * Merge a metadata patch into `conversations.metadata` and bump `updated_at`.
 *
 * Read-modify-write to match recompose/post-upload: read the current metadata,
 * spread `prev` then `patch` (patch wins on key collision), write back the merge
 * plus a fresh `updated_at`. A shallow merge — nested objects in the patch
 * replace, they don't deep-merge — which is exactly what the routes do.
 *
 * Throws on a returned DB error for BOTH the read-back and the write — the
 * Supabase JS client surfaces query failures in `{ error }` rather than
 * throwing, so an unchecked `.update()` would "succeed" silently even when the
 * stamp never landed. Surfacing it as a thrown error matches
 * `appendAssistantFollowup` (the established pattern in this file) and, for the
 * upgrade route, is load-bearing: `markUpgraded` routes through here and the
 * route's retry loop + `appended`-guard catch depend on a failed final stamp
 * THROWING (a silent no-op would let the route report `upgraded:true` while
 * `value_first_upgraded` stays unset, re-opening the duplicate-append window).
 */
export async function snapshotConversationMetadata(
  svc: AnySupabase,
  { conversationId, metadata }: SnapshotConversationMetadataArgs,
): Promise<void> {
  const { data: row, error: readError } = await svc
    .from('conversations')
    .select('metadata')
    .eq('id', conversationId)
    .maybeSingle()

  if (readError) {
    throw new Error(
      `snapshotConversationMetadata: metadata read-back failed: ${readError.message}`,
    )
  }

  const prev = (row?.metadata as Record<string, unknown> | null) ?? {}
  const merged = { ...prev, ...metadata }

  const { error: writeError } = await svc
    .from('conversations')
    .update({ metadata: merged, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (writeError) {
    throw new Error(
      `snapshotConversationMetadata: metadata update failed: ${writeError.message}`,
    )
  }
}

/**
 * Refresh the `merchant_aggregates` materialised view so the behavioural engine
 * sees freshly-imported transactions. Awaited exactly as post-upload does (same
 * RPC, no args — it refreshes the whole MV). Non-fatal: logs and continues on
 * error, matching post-upload's "compose with whatever's in the MV" fallback.
 */
export async function refreshMerchantAggregates(supabase: AnySupabase): Promise<void> {
  const { error } = await supabase.rpc('refresh_merchant_aggregates')
  if (error) {
    console.error('[first-read-followup] refresh_merchant_aggregates failed:', error)
  }
}

// ── Upgrade stamps (declared → transaction Read) ─────────────────────────────
//
// The upgrade route is one-click and re-triggerable from the client, so it needs
// a server-side guard against a double-tap composing twice. We stamp progress on
// `conversations.metadata` (jsonb) rather than a new column (CLAUDE.md Rule 3 —
// no new migrations for state that fits in freeform metadata).
//
//   value_first_upgrade_in_progress : claim is live, composition running
//   value_first_upgraded            : final, the upgrade Read was appended

export const UPGRADE_IN_PROGRESS_KEY = 'value_first_upgrade_in_progress'
export const UPGRADED_KEY = 'value_first_upgraded'

export type ClaimResult = { claimed: boolean }

/**
 * Atomically-as-possible claim the upgrade for a conversation.
 *
 * Sets `metadata.value_first_upgrade_in_progress = true` ONLY when neither that
 * flag nor `value_first_upgraded` is already truthy, and reports whether the
 * claim was won.
 *
 * Concurrency note: the real guard is the UPDATE's WHERE clause, not the
 * pre-read. The write only lands on rows where BOTH stamps are still "not true"
 * at write time, so two racing callers on a clean `{}` row cannot both flip the
 * flag: Postgres row-locks the row, the first writer sets in_progress, and the
 * second writer's recheck of the WHERE clause then matches zero rows. `claimed`
 * reflects whether a row actually came back (`RETURNING id`). Good enough for a
 * one-click UI guard; a fully-atomic version would need an RPC (out of scope —
 * no new migrations).
 *
 * NULL pitfall (the bug this guards against): a JSONB key that is ABSENT yields
 * `metadata->>key = NULL`, and `NULL <> 'true'` is NULL — NOT true — so a plain
 * `.neq('metadata->>key', 'true')` filter EXCLUDES the row. That would deny the
 * normal first-claim case (metadata `{}`, no stamps) entirely. We need IS
 * DISTINCT FROM 'true' semantics: an absent key (or a `false` value) must count
 * as "not set". With the JS client we express that per key as
 * `(metadata->>key IS NULL OR metadata->>key <> 'true')` via a single `.or(...)`
 * call. PostgREST ANDs chained `.or()` calls together, so two separate
 * `.or('K.is.null,K.neq.true')` calls give the AND-of-ORs we want:
 *   WHERE id = X
 *     AND (in_progress IS NULL OR in_progress <> 'true')   -- in_progress IS DISTINCT FROM 'true'
 *     AND (upgraded    IS NULL OR upgraded    <> 'true')   -- upgraded    IS DISTINCT FROM 'true'
 * Do NOT revert these to bare `.neq` — that reintroduces the NULL exclusion bug.
 */
export async function claimUpgradeInProgress(
  svc: AnySupabase,
  conversationId: string,
): Promise<ClaimResult> {
  // 1. Read current stamps. A returned DB error here is a real failure (not a
  //    "no such row" — that surfaces as data:null) and must THROW so the caller
  //    treats the claim as unresolved rather than silently denying it.
  const { data: row, error: readError } = await svc
    .from('conversations')
    .select('metadata')
    .eq('id', conversationId)
    .maybeSingle()

  if (readError) {
    throw new Error(`claimUpgradeInProgress: stamp read failed: ${readError.message}`)
  }

  const prev = (row?.metadata as Record<string, unknown> | null) ?? {}
  if (prev[UPGRADED_KEY] || prev[UPGRADE_IN_PROGRESS_KEY]) {
    return { claimed: false }
  }

  // 2. Conditional write: only rows where BOTH stamps are still "not true" at
  //    write time get the in-progress flag, rejecting rows a racing caller may
  //    have stamped between our read and write. Each `.or(...)` is NULL-aware —
  //    `K.is.null,K.neq.true` ≡ `(K IS NULL OR K <> 'true')` ≡ K IS DISTINCT
  //    FROM 'true' — so an ABSENT key (the normal `{}` first-claim case) and a
  //    `false` value both count as "not set" and the row IS updated. PostgREST
  //    ANDs the two `.or()` calls, so the effective guard is:
  //      id = X AND in_progress IS DISTINCT FROM 'true'
  //             AND upgraded    IS DISTINCT FROM 'true'
  //    Plain `.neq` here would be WRONG: NULL <> 'true' is NULL, excluding the
  //    absent-key row and denying every legitimate first claim.
  const merged = { ...prev, [UPGRADE_IN_PROGRESS_KEY]: true }
  const { data: updated, error: writeError } = await svc
    .from('conversations')
    .update({ metadata: merged, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .or(`metadata->>${UPGRADE_IN_PROGRESS_KEY}.is.null,metadata->>${UPGRADE_IN_PROGRESS_KEY}.neq.true`)
    .or(`metadata->>${UPGRADED_KEY}.is.null,metadata->>${UPGRADED_KEY}.neq.true`)
    .select('id')
    .maybeSingle()

  // A returned DB error is a real failure (different from a legitimate zero-row
  // result) and must THROW so the caller doesn't mistake a broken query for a
  // lost race. Crucially, this is checked BEFORE the zero-row interpretation
  // below: a failed query is an error; a clean zero-row match is NOT.
  if (writeError) {
    throw new Error(`claimUpgradeInProgress: claim write failed: ${writeError.message}`)
  }

  // No error AND no row came back → the WHERE guard matched nothing (already
  // stamped, or a concurrent claim beat us to it). That is a legitimate
  // not-claimed outcome, not an error.
  return { claimed: Boolean(updated?.id) }
}

/**
 * Clear the in-progress flag (e.g. composition failed and we want to allow a
 * retry). Thin wrapper over snapshotConversationMetadata — inherits its
 * throw-on-DB-error behaviour. (The upgrade route wraps its clears in `safeClear`
 * precisely because a thrown clear must not mask the real exit reason.)
 */
export async function clearUpgradeInProgress(
  svc: AnySupabase,
  conversationId: string,
): Promise<void> {
  await snapshotConversationMetadata(svc, {
    conversationId,
    metadata: { [UPGRADE_IN_PROGRESS_KEY]: false },
  })
}

/**
 * Stamp the final `value_first_upgraded = true` and clear the in-progress flag.
 * Merges extra metadata (e.g. the upgrade composition snapshot) in the same
 * write so callers don't need a second round-trip.
 *
 * Throws on a returned DB error (via snapshotConversationMetadata) — this is
 * load-bearing for the upgrade route's idempotency: its retry loop catches the
 * throw to retry, and on exhaustion re-throws into the `appended`-guard catch so
 * a delivered-but-unstamped Read blocks retries rather than reporting success
 * with the stamp unset.
 */
export async function markUpgraded(
  svc: AnySupabase,
  conversationId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await snapshotConversationMetadata(svc, {
    conversationId,
    metadata: {
      ...extra,
      [UPGRADED_KEY]: true,
      [UPGRADE_IN_PROGRESS_KEY]: false,
    },
  })
}
