import type { ValueQuadrant, MoneyPersonality, ValueMapResult } from '@/lib/value-map/types'

// ── Onboarding-v2 walk stages ───────────────────────────────────────────────
// The v1 modal flow walked a fixed sequence of "beats" inside a modal. The
// v2 flow is route-based: the user clicks through actual pages. Each stage
// below corresponds to a milestone the driver verifies.
//
// Marcus path (entry_struggle = 'dont_know'):
//   struggle_submitted → value_map_done → upload_done → archetype_shown → complete
// Chat-first path (entry_struggle ∈ {wealth, debt, planning, free_text}):
//   struggle_submitted → chat_opener

export type OnboardingStage =
  | 'struggle_submitted'
  | 'value_map_done'
  | 'upload_done'
  | 'archetype_shown'
  | 'complete'      // Marcus: landed in /office?chat=open with first_insight conversation
  | 'chat_opener'   // Non-Marcus: landed in chat directly from struggle screen

// ── Scripted Value Map response ─────────────────────────────────────────────
// Same shape as the runtime ValueMapResult, but merchant + transaction_id are
// auto-filled from SAMPLE_TRANSACTIONS by cardId.

export interface PersonaValueMapResponse {
  cardId: string
  quadrant: ValueQuadrant | null
  confidence: number
  firstTapMs: number | null
  cardTimeMs: number
  deliberationMs: number
  hardToDecide?: boolean
}

// ── Persona profile (written to user_profiles after signup) ─────────────────

export interface PersonaProfile {
  displayName: string
  country: string
  city?: string
  currency: string
}

// ── Persona CSV upload ──────────────────────────────────────────────────────

export interface PersonaCsv {
  filename: string
  contentBase64: string
  expectedBank: 'revolut' | 'santander' | 'generic'
}

// ── Entry struggle ──────────────────────────────────────────────────────────

export type EntryStruggle = 'dont_know' | 'debt' | 'wealth' | 'planning' | 'free_text'

// ── Expectations (assertions the runner checks) ─────────────────────────────

export interface PersonaExpectations {
  /** What the persona picks (or types) on the /onboarding-v2 struggle screen. */
  entryStruggle: EntryStruggle
  /** Required when entryStruggle === 'free_text'. */
  entryStruggleText?: string
  /**
   * Expected archetype reading. Null for chat-first paths that never reach
   * the archetype screen (only Marcus / dont_know reaches it).
   */
  archetype: {
    expectedQuadrant: ValueQuadrant
    personalityId: MoneyPersonality
  } | null
  /** Stages the driver must reach for the run to be functionally passing. */
  stagesCompleted: OnboardingStage[]
  /**
   * DB state asserted once the driver lands at the terminal stage
   * ('complete' for Marcus, 'chat_opener' for non-Marcus). Field shape
   * is unchanged from v1 — kept as `dbAfterHandoff` to avoid renames in
   * captured-output JSON files.
   */
  dbAfterHandoff: {
    user_profiles?: Record<string, unknown>
    financial_portrait?: Record<string, unknown>
    transactions?: { countBetween: [number, number] }
    onboarding_progress?: Record<string, unknown>
  }
  hardRules?: {
    bannedWords?: string[]
    bannedPatterns?: string[]
    archetype?: {
      mustReferenceQuadrant?: ValueQuadrant
      mustMentionOneOf?: string[]
      mustAcknowledgeOneOf?: string[]
    }
    insight?: {
      mustReferenceMerchantsFromCsv?: string[]
      mustReferenceOneOf?: string[]
      numbersMustMatchCsv?: boolean
    }
  }
  likertDimensions: ('warmth' | 'accuracy' | 'on_brand_voice' | 'persona_fit' | 'actionability')[]
}

// ── Full persona definition ─────────────────────────────────────────────────

export interface Persona {
  id: string
  label: string
  profile: PersonaProfile
  /** Null when the persona never reaches the Value Map (chat-first paths). */
  valueMapResponses: PersonaValueMapResponse[] | null
  /** Null when the persona never reaches the upload step (chat-first paths). */
  csv: PersonaCsv | null
  expectations: PersonaExpectations
}

export type { ValueMapResult }
