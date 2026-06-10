// ── Value Map types ──────────────────────────────────────────────────────────

export type ValueQuadrant = 'foundation' | 'investment' | 'burden' | 'leak'

export type ValueMapGranularity = 'category' | 'intent'

export interface ValueMapTransaction {
  id: string
  merchant: string | null
  description: string | null
  amount: number
  currency: string
  transaction_date: string
  is_recurring: boolean
  category_name?: string | null
  context?: string
  // DB category slug this card maps to. Required on sample cards; nullable
  // on personal/retake flows where the source transaction may be uncategorised.
  category_id?: string | null
  // 'category' = card represents the whole DB category (rent IS housing);
  // 'intent'   = card represents one slice of a multi-intent category.
  // Only 'category' cards seed value_category_rules from VM completion.
  // Undefined on personal/retake flows (which seed rules via a different path).
  granularity?: ValueMapGranularity
}

export interface ValueMapResult {
  transaction_id: string
  quadrant: ValueQuadrant | null // null when hard_to_decide
  merchant: string
  amount: number
  confidence: number             // 1-5, default 3 (0 for hard_to_decide)
  first_tap_ms: number | null    // ms from card shown to first quadrant tap
  card_time_ms: number           // ms from card shown to confirm/skip
  deliberation_ms: number        // gap between first tap and confirm
  hard_to_decide?: boolean
  // VM-3: answered only when the card asks (leak → "Would you cut this?",
  // burden → "Would you change this if it were easy?"). Null/undefined when
  // the question never showed (foundation/investment/unsure, or legacy flows).
  cut_intent?: boolean | null
}

export type MoneyPersonality =
  | 'builder'
  | 'fortress'
  | 'truth_teller'
  | 'drifter'
  | 'anchor'

export interface QuadrantDef {
  id: ValueQuadrant
  name: string
  colour: string
  emoji: string
  tagline: string
  description: string
}

export interface PersonalityDef {
  id: MoneyPersonality
  name: string
  emoji: string
  headline: string
  description: string
}

export interface Observation {
  rule: string        // e.g. 'contradiction', 'hesitation_spike'
  priority: number    // 1 = highest
  text: string        // fully rendered observation text
  merchants: string[]
}
