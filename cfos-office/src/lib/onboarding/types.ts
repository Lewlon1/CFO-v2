// ── Onboarding types ────────────────────────────────────────────────────────

// Result of /api/onboarding/generate-insight — Wow Moment v2.
//
// On success the four-beat fields (observed/named/asked/proposed) are
// populated and the modal renders the locked layout. On fallback (no
// candidate, validator failure, generation error) only `narrative` is set
// and the modal shows the deterministic continue card.
//
// `candidate_token` is an HMAC-signed envelope echoed back to
// /api/onboarding/save-experiment when the user taps the experiment CTA.
export interface FirstInsightResult {
  narrative?: string
  observed?: string
  named?: string
  asked?: string
  proposed?: string
  candidate_token?: string
}

export const ONBOARDING_BEATS = [
  'welcome',
  'framework',
  'value_map',
  'archetype',
  'csv_upload',
  'capabilities',
  'first_insight',
  'handoff',
] as const

export type OnboardingBeat = (typeof ONBOARDING_BEATS)[number]

export interface BeatMessage {
  id: string
  text?: string
  delayMs: number
  action?: 'continue' | 'embed_value_map' | 'embed_upload' | 'capability_picker' | 'handoff'
  buttonText?: string
}

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
  transactionCount?: number
  selectedCapabilities?: string[]
  importBatchId?: string | null
  // LLM-generated archetype (Phase 1)
  archetypeData?: ArchetypeData
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
  // First-insight narration + stat cards from the PR #31 pattern engine
  insightData?: FirstInsightResult
  // User's emoji rating of the first insight (1-5)
  insightRating?: number
  // Which experiment (if any) the user accepted during the first_insight beat.
  // Set when handleAcceptExperiment persists the experiment as an action_item
  // and advances to the handoff beat. Used for analytics / profile seeding.
  acceptedExperiment?: string
}

export interface OnboardingState {
  beat: OnboardingBeat
  messageIndex: number
  completedBeats: OnboardingBeat[]
  startedAt: string
  skippedAt?: string | null
  completedAt?: string | null
  data: OnboardingData
}

export type OnboardingAction =
  | { type: 'ADVANCE_MESSAGE' }
  | { type: 'COMPLETE_BEAT'; beat: OnboardingBeat; data?: Partial<OnboardingData> }
  | { type: 'SET_DATA'; data: Partial<OnboardingData> }
  | { type: 'SKIP' }
  | { type: 'DISMISS' }
