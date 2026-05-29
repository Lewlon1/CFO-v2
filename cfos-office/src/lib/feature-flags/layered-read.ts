/**
 * Feature flag for the layered Read architecture (Session 32 → value-first).
 *
 * Gates:
 *   - `get_cluster_behaviour` and `get_conversation_signals` tool registration
 *   - The layered-read instructions section of the system prompt
 *   - The fire-and-forget chat-signal extraction hook in /api/chat
 *   - The value-first onboarding sequence (processing → confirm → hook → recompose)
 *
 * DEFAULT ON (go-live). The layered Read is now the canonical onboarding +
 * first-insight path for every user.
 *
 * Kill-switch: set `LAYERED_READ_DISABLED=true` (env / Vercel) to instantly
 * revert every user to the legacy pre-layered path with no code change or
 * redeploy. Retained as a runtime rollback through the first live cohort; the
 * dead pre-layered path (the `!isLayeredReadEnabled()` branches + computeFirstInsight
 * onboarding path) is removed in a follow-up once the layered flow is proven in prod.
 */
export function isLayeredReadEnabled(): boolean {
  if (process.env.LAYERED_READ_DISABLED === 'true') return false;
  return true;
}
