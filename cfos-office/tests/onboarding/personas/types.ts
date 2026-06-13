import type { ValueQuadrant, MoneyPersonality, ValueMapResult } from '@/lib/value-map/types'
import type { DoorFamily } from '@/lib/onboarding-v2/door/door-config'
import type { RelateOptionId } from '@/lib/onboarding-v2/composite/composite-config'
import type { DeadlineOption } from '@/lib/onboarding-v2/goal-config'
import type {
  HousingBandId,
  SubsBandId,
  BillsBandId,
  FoodOutBandId,
  SaveReachBandId,
} from '@/lib/onboarding-v2/estimates/bands'

// ── Onboarding-v2 walk stages (estimates-first, in-sheet beats at /office) ───
// The current default flow runs entirely inside the chat sheet at /office,
// advancing by onboarding_step (EstimateBeatHost for the estimate beats,
// OnboardingBeatHost for the optional statement-check mission). No statement is
// uploaded before the estimate Read — the band sketch IS the input. Each stage
// below is a milestone the driver verifies:
//   door_done → context_done → composite_done → goal_done → income_done →
//   sketch_done → verdicts_done → estimate_read
// then, for personas that opt into the optional accuracy pass:
//   check_upload_done → check_confirm_done → reality_check

export type OnboardingStage =
  | 'door_done' // door beat answered (name + situation/family) → context beat
  | 'context_done' // country + age band saved → composite beat
  | 'composite_done' // composite reaction (+ optional re-pick) saved → goal beat
  | 'goal_done' // deadline (+ optional alt-goal) picked → income beat
  | 'income_done' // income typed + pace acknowledged → sketch beat
  | 'sketch_done' // five band taps saved → verdicts beat
  | 'verdicts_done' // top value + three verdicts saved → estimate Read composes
  | 'estimate_read' // estimate Read delivered (1st assistant msg) — completion gate
  // ── Optional statement-check mission (runStatementCheck personas only) ─────
  | 'check_upload_done' // real statement uploaded → check processing → confirm beat
  | 'check_confirm_done' // real fixed costs confirmed → reality-check Read composes
  | 'reality_check' // reality-check Read delivered (2nd assistant msg, same convo)

/** The seven estimate beats every persona walks, ending on the estimate Read. */
export const ESTIMATE_STAGES: readonly OnboardingStage[] = [
  'door_done',
  'context_done',
  'composite_done',
  'goal_done',
  'income_done',
  'sketch_done',
  'verdicts_done',
  'estimate_read',
] as const

/** The optional statement-check mission stages (runStatementCheck personas). */
export const CHECK_STAGES: readonly OnboardingStage[] = [
  'check_upload_done',
  'check_confirm_done',
  'reality_check',
] as const

// ── Scripted Value Map response ─────────────────────────────────────────────
// Same shape as the runtime ValueMapResult, but merchant + transaction_id are
// auto-filled from SAMPLE_TRANSACTIONS by cardId. RETAINED so the Value Map
// personality engine keeps unit coverage (unit/calculate-personality.test.ts);
// the OB-4 estimates-first walk stops at the reality-check Read and does NOT
// drive the Value Map (that recompose is a later/stretch leg).

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
  /** The composite beat only offers GB/ES — the context beat sets the currency. */
  country: 'GB' | 'ES'
  city?: string
  currency: string
  /** Typed into the estimate income beat. Driver falls back to a default if unset. */
  monthlyIncome?: number
  /** Retained for realism; the housing sketch band stands in for rent in the flow. */
  monthlyRent?: number
}

// ── Persona CSV upload (statement-check mission only) ────────────────────────

export interface PersonaCsv {
  filename: string
  contentBase64: string
  expectedBank: 'revolut' | 'santander' | 'generic'
}

// ── Door entry ──────────────────────────────────────────────────────────────
// Legacy entry_struggle enum. The door beat writes one of these (via
// familyToStruggle) and the driver derives the door FAMILY from it
// (struggleToFamily) unless `doorFamily` is set explicitly.

export type EntryStruggle = 'dont_know' | 'debt' | 'wealth' | 'planning' | 'free_text'

// ── Context beat age band ─────────────────────────────────────────────────
// ASCII-safe keys; the driver maps each to the live en-dash testid
// (context-age-18–29 …) so persona files stay free of unicode dashes.
export type AgeBand = '18-29' | '30-39' | '40-49' | '50+'

// ── Verdicts beat ─────────────────────────────────────────────────────────
export type EstimateVerdict = 'worth_it' | 'leak' | 'unsure'

/** The verdicts beat top-value chips (verbatim from verdicts-beat-block.tsx). */
export const TOP_VALUES = ['Freedom', 'Security', 'Family', 'Experiences', 'Growth'] as const
export type TopValue = (typeof TOP_VALUES)[number]

/** The five sketch band ids the persona taps (one per question). */
export interface PersonaSketchBands {
  housing: HousingBandId
  subs: SubsBandId
  bills: BillsBandId
  foodOut: FoodOutBandId
  saveReach: SaveReachBandId
}

/** The three domain verdicts the persona gives on the verdicts beat. */
export interface PersonaVerdicts {
  subscriptions: EstimateVerdict
  foodOut: EstimateVerdict
  drift: EstimateVerdict
}

// ── Expectations (assertions the runner checks) ─────────────────────────────

export interface PersonaExpectations {
  // ── Door beat ──
  /** Mapped to a door family via struggleToFamily unless doorFamily is set. */
  entryStruggle: EntryStruggle
  /** Required when doorVia === 'free_text'. */
  entryStruggleText?: string
  /** Explicit door family override; defaults to struggleToFamily(entryStruggle). */
  doorFamily?: DoorFamily
  /** Drive the door via a situation chip (default) or free text + classification. */
  doorVia?: 'chip' | 'free_text'

  // ── Context beat ──
  ageBand: AgeBand

  // ── Composite beat ──
  compositeRelate: RelateOptionId
  /** Required by the UI when compositeRelate === 'not_me' (one re-pick). */
  compositeRepickFamily?: DoorFamily
  /** Optional truer line (shown for 'close' / 'not_me'). */
  compositeTruerLine?: string

  // ── Goal beat ──
  goalDeadline: DeadlineOption['id']
  /** Optional escape-hatch alt-goal family (re-anchors the inferred goal). */
  goalAltFamily?: DoorFamily

  // ── Sketch + verdicts beats ──
  sketchBands: PersonaSketchBands
  topValue: TopValue
  verdicts: PersonaVerdicts

  // ── Optional statement-check mission ──
  /** When true the persona uploads its CSV and walks the reality-check Read. */
  runStatementCheck: boolean

  /**
   * Optional Value Map archetype expectation. Drives ONLY the personality-engine
   * unit test (unit/calculate-personality.test.ts), not the estimates-first walk.
   */
  archetype?: {
    expectedQuadrant: ValueQuadrant
    personalityId: MoneyPersonality
  } | null

  /** Stages the driver must reach for the run to be functionally passing. */
  stagesCompleted: OnboardingStage[]

  /**
   * DB state asserted once the driver lands at the terminal stage. The
   * estimates-first terminal invariants (onboarding_step, onboarding_completed_at,
   * onboarding_estimates completeness, goal persistence, verification) are derived
   * automatically from runStatementCheck in assertDbState — this block only
   * carries persona-specific overrides (e.g. the imported transaction count).
   */
  dbAfterHandoff: {
    user_profiles?: Record<string, unknown>
    /** Transaction count after the statement-check import (check personas only). */
    transactions?: { countBetween: [number, number] }
  }
  hardRules?: {
    bannedWords?: string[]
    bannedPatterns?: string[]
    /** Terms the Read must reference at least one of (grounding check). */
    read?: {
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
  /** Scripted Value Map sort (personality-engine unit test only — see above). */
  valueMapResponses: PersonaValueMapResponse[] | null
  /** CSV uploaded during the statement-check mission. Null for non-check personas. */
  csv: PersonaCsv | null
  expectations: PersonaExpectations
}

export type { ValueMapResult }
