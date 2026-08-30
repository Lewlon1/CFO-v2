// Session 083 — the wire contract for a First Read error report, shared by the
// client control (src/components/chat/ReadErrorReport.tsx) and the route that
// stores it (src/app/api/reads/feedback/route.ts).
//
// It lives here rather than being exported from the component — the repo's usual
// habit (see LabelTransactionsBlock) — precisely because the route needs it too,
// and a server route should not import a 'use client' module to get at a
// constant. Keeping the cap in one place is what stops the textarea's maxLength,
// the zod schema, and the DB check constraint from drifting apart.

/**
 * Max length of a report body. Must stay in lockstep with the
 * `char_length(body) between 1 and 2000` check in migration 083.
 */
export const MAX_REPORT_LENGTH = 2000;

export type ReadFeedbackPayload = {
  first_read_message_id: string;
  conversation_id: string;
  body: string;
};

/**
 * Build the exact body the route's zod schema expects. Trims, because a report
 * of pure whitespace is not a report — the route would reject it, and catching
 * it here keeps the client's Send button honest.
 */
export function buildReportPayload(
  first_read_message_id: string,
  conversation_id: string,
  body: string,
): ReadFeedbackPayload {
  return {
    first_read_message_id,
    conversation_id,
    body: body.trim(),
  };
}

/** Whether a draft is worth sending. Mirrors the schema's min(1)/max() bounds. */
export function isSendableReport(draft: string): boolean {
  const trimmed = draft.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_REPORT_LENGTH;
}
