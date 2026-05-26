/**
 * Feature flag for the layered Read architecture (Session 32).
 *
 * Gates:
 *   - `get_cluster_behaviour` and `get_conversation_signals` tool registration
 *   - The layered-read instructions section of the system prompt
 *   - The fire-and-forget chat-signal extraction hook in /api/chat
 *
 * Active on:
 *   - Vercel deploys where the git ref is exactly 'session-32/the-read'
 *   - Local dev when LAYERED_READ_LOCAL_OVERRIDE=true in .env.local
 *
 * Removed in Session D (cleanup) when the layered model becomes default.
 */
export function isLayeredReadEnabled(): boolean {
  if (process.env.VERCEL_GIT_COMMIT_REF === 'session-32/the-read') return true;
  if (process.env.LAYERED_READ_LOCAL_OVERRIDE === 'true') return true;
  return false;
}
