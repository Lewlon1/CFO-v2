// VM-4 — the transport shape the archetype reveal renders from. Computed
// entirely server-side in POST /api/value-map/onboarding; the 2–3 sentence
// reading is fetched separately (POST /api/value-map/reading) so the reveal
// renders immediately.

export interface RevealPayload {
  sessionId: string
  family: string | null
  certainty: string | null
  /** e.g. "The Fortress"; null = the "still reading you" fallback state. */
  displayName: string | null
  usedFallback: boolean
  receiptHeadline: string | null
  receiptBands: string | null
  tensionLine: string | null
}
