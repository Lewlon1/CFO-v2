/**
 * Feature flag for the layered Read architecture (Session 32).
 *
 * Gates:
 *   - `get_cluster_behaviour` and `get_conversation_signals` tool registration
 *   - The layered-read instructions section of the system prompt
 *   - The fire-and-forget chat-signal extraction hook in /api/chat
 *
 * Active on:
 *   - Vercel deploys where the git ref is on the layered-read tree:
 *     the canonical Session 32 branch, the value-first-onboarding child, and
 *     the bill-benchmark-reference grandchild. New downstream branches that
 *     intend to dogfood the layered Read need to be added here explicitly —
 *     a partial-match (startsWith / includes) would silently opt-in unrelated
 *     branches, so the list stays explicit.
 *   - Local dev when LAYERED_READ_LOCAL_OVERRIDE=true in .env.local
 *
 * Removed in Session D (cleanup) when the layered model becomes default.
 */
const LAYERED_READ_BRANCHES: ReadonlySet<string> = new Set([
  'session-32/the-read',
  'claude/value-first-onboarding-7zfiI',
  'claude/bill-benchmark-reference-vH2bh',
]);

export function isLayeredReadEnabled(): boolean {
  const ref = process.env.VERCEL_GIT_COMMIT_REF;
  if (ref && LAYERED_READ_BRANCHES.has(ref)) return true;
  if (process.env.LAYERED_READ_LOCAL_OVERRIDE === 'true') return true;
  return false;
}
