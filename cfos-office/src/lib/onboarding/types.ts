// ── Onboarding types ────────────────────────────────────────────────────────
// Shared shapes for the archetype reveal in onboarding-v2. The v1 modal
// "beat machine" (ONBOARDING_BEATS, OnboardingState, OnboardingAction, etc.)
// has been removed along with the modal itself.

export interface ArchetypeData {
  archetype_name: string
  archetype_subtitle: string
  traits: [string, string, string]
  certainty_areas: string[]
  conflict_areas: string[]
}

export interface OnboardingData {
  name?: string
  currency?: string
  personalityType?: string
  dominantQuadrant?: string
  breakdown?: Record<string, { total: number; percentage: number; count: number }>
  // Value Map results for archetype generation
  valueMapResults?: Array<{
    transaction_id: string
    quadrant: string | null
    merchant: string
    amount: number
    confidence: number
    first_tap_ms: number | null
    card_time_ms: number
    deliberation_ms: number
    hard_to_decide?: boolean
  }>
}
