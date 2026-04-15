// ── Onboarding types ────────────────────────────────────────────────────────

import type { FirstInsightCards } from '@/lib/analytics/first-insight'

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
  // Structured first-insight data (3-card mini-dashboard)
  insightData?: FirstInsightCards
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
