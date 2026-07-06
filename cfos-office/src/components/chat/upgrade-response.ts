/**
 * Pure mapping from the /api/insights/upgrade-declared-read response to the
 * client action the chat upload surface should take. Kept free of React so the
 * decision table is unit-testable in isolation (the highest-value test for this
 * flow — every decline/error must resolve to a non-destructive, non-scary path).
 *
 * The route's response contract (see route.ts):
 *   success      → 200 { upgraded:true,  conversationId }
 *   decline      → 200 { upgraded:false, reason:'already_upgraded'|'no_transactions'
 *                        |'insufficient_data', conversationId? }
 *   no_layered   → 404 { upgraded:false, reason:'no_layered_read' }
 *   in_progress  → 409 { upgraded:false, reason:'in_progress', conversationId? }
 *   server error → 500 { upgraded:false, reason:'bad_close'|'compose_failed'
 *                        |'stamp_failed'|'count_failed', conversationId? }
 *
 * Two reasons get special treatment here:
 *   - 'no_transactions' and 'insufficient_data' each earn a user-facing nudge —
 *     the user just watched "Reading your statements…", so a silent close reads
 *     as a broken upload.
 *   - 'stamp_failed' is a delivered Read whose final metadata stamp didn't land
 *     (the route only returns it AFTER the follow-up message appended) — the
 *     client shows the Read, never an error.
 */

export type UpgradeResponseBody = {
  upgraded?: boolean
  reason?: string
  conversationId?: string
}

/**
 * What the surface should do next:
 *   - 'load_and_close' — the sharpened Read landed (or a benign decline that
 *     still points at a conversation). loadConversation(conversationId) then
 *     close. `conversationId` is always present here.
 *   - 'close'          — close the surface, leaving the declared Read in place;
 *     no scary error. Optionally loadConversation first if one was returned.
 *   - 'notify_close'   — close, then show a brief, kind nudge (thin upload or
 *     zero-row import).
 *   - 'retry'          — show a retryable error; "Try again" re-POSTs the same
 *     route WITHOUT re-uploading.
 */
export type UpgradeAction =
  | { kind: 'load_and_close'; conversationId: string }
  | { kind: 'close'; conversationId?: string }
  | { kind: 'notify_close'; message: string }
  | { kind: 'retry' }

// The thin-upload nudge copy. Kind, brief, points at the concrete next step
// (a fuller export) without advice or alarm.
export const INSUFFICIENT_DATA_NUDGE =
  'These statements were a bit thin to sharpen the picture — try a full 3-month export.'

// The zero-row-import nudge. The file parsed but added nothing readable — the
// user's effort gets a response, not a silent close indistinguishable from
// success.
export const NO_TRANSACTIONS_NUDGE =
  "That file didn't add any transactions I could read — try a CSV export covering your last 3 months."

/**
 * Decide the client action from the HTTP status + parsed body.
 *
 * `body` may be null when the response wasn't JSON (e.g. a gateway 502 / network
 * blip surfaced as an unparseable body) — those are treated as retryable.
 */
export function decideUpgradeAction(
  status: number,
  body: UpgradeResponseBody | null,
): UpgradeAction {
  // Success: the follow-up Read is live in the conversation. Load it, then close.
  if (status === 200 && body?.upgraded === true && body.conversationId) {
    return { kind: 'load_and_close', conversationId: body.conversationId }
  }

  const reason = body?.reason

  // Thin upload — earns a user-facing nudge. Leave the declared Read as the
  // last word and invite a fuller export.
  if (reason === 'insufficient_data') {
    return { kind: 'notify_close', message: INSUFFICIENT_DATA_NUDGE }
  }

  // Zero-row import — the upload "worked" but added nothing readable. The
  // declared Read is unchanged, so a reload adds nothing; the nudge is what
  // tells the user their effort registered and what to try instead.
  if (reason === 'no_transactions') {
    return { kind: 'notify_close', message: NO_TRANSACTIONS_NUDGE }
  }

  // Delivered-but-unstamped: the route returns stamp_failed ONLY after the
  // follow-up Read appended, so the happy outcome exists — show it. (A retry
  // here would 409 against the deliberately-held in-progress claim anyway.)
  if (reason === 'stamp_failed' && body?.conversationId) {
    return { kind: 'load_and_close', conversationId: body.conversationId }
  }

  // Benign declines + already-claimed in-flight: close quietly. If the route
  // handed back a conversationId, refresh it first (the in-flight request, or a
  // prior run, may have already appended the Read) — otherwise just close.
  if (
    reason === 'already_upgraded' ||
    reason === 'no_layered_read' ||
    reason === 'in_progress'
  ) {
    return body?.conversationId
      ? { kind: 'load_and_close', conversationId: body.conversationId }
      : { kind: 'close' }
  }

  // Everything else — the 500 family (bad_close / compose_failed /
  // count_failed, or a stamp_failed missing its conversationId) and any
  // unrecognised/unparseable response — is retryable. The transactions are
  // already imported, so retry re-POSTs without re-upload.
  return { kind: 'retry' }
}
