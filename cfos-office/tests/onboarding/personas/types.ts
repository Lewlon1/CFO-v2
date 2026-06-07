import type { ValueQuadrant, MoneyPersonality, ValueMapResult } from '@/lib/value-map/types'

// ── Onboarding-v2 walk stages (value-first, in-sheet beats at /office) ───────
// The current flow runs entirely inside the chat sheet at /office, advancing by
// onboarding_step (OnboardingBeatHost), with NO Marcus/chat-first split:
//   struggle_submitted → goal_done → upload_done → essentials_done →
//   confirm_done → first_read
// Each stage is a milestone the driver verifies.

export type OnboardingStage =
  | 'struggle_submitted'  // in-sheet "what brought you in?" answered
  | 'goal_done'           // goal beat resolved (goal set or skipped → upload_pending)
  | 'upload_done'         // statement uploaded → essentials beat shows
  | 'essentials_done'     // income + rent submitted → confirm beat shows
  | 'confirm_done'        // fixed costs confirmed → Read composes
  | 'first_read'          // first_read assistant message delivered into the sheet

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
  /** Typed into the value-first essentials beat. Driver falls back to a default if unset. */
  monthlyIncome?: number
  monthlyRent?: number
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
   * Optional goal seeded (via the admin client) before the upload beat, so the
   * value-first First Read can be checked for goal-awareness — the CFO must
   * never deny a goal it has (regression for the goal-denial fix).
   */
  goal?: {
    name: string
    type?: 'debt_clearance' | 'savings' | 'investment' | 'general'
    targetAmount: number
    currentAmount?: number
    targetDate?: string
  }
  /**
   * DB state asserted once the driver lands at the terminal stage
   * ('first_read'). Field shape is unchanged — kept as `dbAfterHandoff`
   * to avoid renames in captured-output JSON files.
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
