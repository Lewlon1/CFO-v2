/**
 * Map a chat transport error to the banner copy the user sees. Pure so the
 * decision table is unit-testable (the transport surfaces the raw response
 * body as error.message).
 *
 * The `limit` case carries its own server-authored C.-voiced message
 * (llm-guard's LLM_LIMIT_MESSAGE) — render it verbatim so the copy lives in
 * exactly one place (Rule 7). Everything else keeps the existing fixed
 * strings.
 */
export function mapChatErrorMessage(rawMessage: string | undefined): string {
  const msg = rawMessage || ''

  // Cost-guard block: {"error":"limit","message":"…"}. Parse defensively —
  // any malformed body falls through to the generic mappings below.
  try {
    const parsed = JSON.parse(msg) as { error?: string; message?: string }
    if (parsed?.error === 'limit' && typeof parsed.message === 'string' && parsed.message) {
      return parsed.message
    }
  } catch {
    // Not JSON — fall through.
  }

  if (msg.includes('429') || msg.toLowerCase().includes('busy')) {
    return 'Too many requests. Please wait a moment and try again.'
  }
  if (msg.includes('504') || msg.toLowerCase().includes('timeout')) {
    return 'Response timed out. Please try again.'
  }
  return 'Something went wrong. Please try again.'
}
