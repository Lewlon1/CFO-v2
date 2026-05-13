import type { ValueQuadrant, MoneyPersonality, ValueMapResult } from '@/lib/value-map/types'

// The v1 modal flow defined an OnboardingBeat enum (welcome | framework |
// value_map | archetype | csv_upload | capabilities | first_insight |
// handoff). The modal is gone; these persona fixtures still describe the
// old beat shape and aren't wired to the route-based v2 flow yet. Keep
// the type as a string alias so the runner type-checks until the fixtures
// are refactored against v2.
type OnboardingBeat = string

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

// ── Expectations (assertions the runner checks) ─────────────────────────────

export interface PersonaExpectations {
  archetype: {
    expectedQuadrant: ValueQuadrant
    personalityId: MoneyPersonality
  }
  beatsCompleted: OnboardingBeat[]
  beatsSkipped: OnboardingBeat[]
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
  valueMapResponses: PersonaValueMapResponse[] | null
  csv: PersonaCsv | null
  skipBeats: OnboardingBeat[]
  expectations: PersonaExpectations
}

export type { ValueMapResult }
