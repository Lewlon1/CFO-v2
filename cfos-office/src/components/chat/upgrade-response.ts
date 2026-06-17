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
 *   - 'notify_close'   — close, then show a brief, kind nudge (thin upload).
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

  // Thin upload — the only decline that earns a user-facing nudge. Leave the
  // declared Read as the last word and invite a fuller export.
  if (reason === 'insufficient_data') {
    return { kind: 'notify_close', message: INSUFFICIENT_DATA_NUDGE }
  }

  // Benign declines + already-claimed in-flight: close quietly. If the route
  // handed back a conversationId, refresh it first (the in-flight request, or a
  // prior run, may have already appended the Read) — otherwise just close.
  if (
    reason === 'already_upgraded' ||
    reason === 'no_transactions' ||
    reason === 'no_layered_read' ||
    reason === 'in_progress'
  ) {
    return body?.conversationId
      ? { kind: 'load_and_close', conversationId: body.conversationId }
      : { kind: 'close' }
  }

  // Everything else — the 500 family (bad_close / compose_failed / stamp_failed
  // / count_failed) and any unrecognised/unparseable response — is retryable.
  // The transactions are already imported, so retry re-POSTs without re-upload.
  return { kind: 'retry' }
}
