// Pure type module for the Wow Moment v2 experiment pipeline. No Supabase
// imports here so detectors and templates stay testable in isolation.

export type ObservationType = 'high_freq_merchant' | 'category_variance' | 'time_pattern'

export type ExperimentStatus = 'active' | 'completed' | 'dismissed' | 'expired'

// Minimal transaction shape consumed by detectors. The candidate engine maps
// rows from `public.transactions` into this shape — detectors never see the
// full table row, which keeps their dependency surface small.
export interface TransactionRow {
  id: string
  date: string
  description: string
  amount: number
  category: string | null
  value_category: string | null
}

export interface ObservationCandidate {
  observation_type: ObservationType
  pattern_template_key: string
  candidate_score: number
  payload: Record<string, unknown>
  currency: string
}

export interface DetectorInput {
  transactions: TransactionRow[]
  archetype: string | null
  currency: string
  country: string | null
}

export type Detector = (input: DetectorInput) => Promise<ObservationCandidate[]>

export interface ActiveExperimentInsert {
  user_id: string
  conversation_id?: string | null
  observation_type: ObservationType
  pattern_template_key: string
  pattern_name: string
  observation_payload: Record<string, unknown>
  question: string
  experiment_text: string
  noticing_target: string
  status: ExperimentStatus
  proposed_at: string
  accepted_at?: string | null
  callback_due_at: string
}

// Returned by the wow-moment generator and rendered by InsightBeat. The
// modal's existing `state.data.insightData` keeps `narrative` for the
// fallback case; the four-beat fields are populated when generation succeeds.
export interface WowMomentResult {
  observed: string
  named: string
  asked: string
  proposed: string
  narrative?: string
  candidate_token?: string
  pattern_name?: string
  experiment_text?: string
}

// ── v3: Evidence pool + tier-based authoring ────────────────────────────────
// v2 (above) keeps the original 3 detector types. v3 federates a wider pool
// of detectors into Evidence records and lets Opus author all four beats.
// New types below; v2 types remain so existing detectors keep compiling.

export type EvidenceSource =
  | 'duplicate_charge'
  | 'evening_cluster'
  | 'foreign_fee'
  | 'big_ticket'
  | 'cash_transfer'
  | 'gap'
  | 'holiday_cluster'
  | 'recurring_overlap'
  | 'high_freq_merchant'
  | 'category_variance'
  | 'time_pattern'

export type Tier = 'tier_1' | 'tier_2' | 'tier_3'

// What the user actually has in the database. Drives tier classification
// when no high-impact evidence fires.
export interface DataDepth {
  days: number          // span between earliest and latest tx date
  txCount: number       // non-deleted transactions in the 90-day window
  categorisedShare: number  // 0-1 — fraction with a category_id
}

// Every numeric or merchant token the author may use must trace back to one
// of these. The validator extracts tokens from the four authored fields and
// checks each against the union of all `value`/`alt_forms` here.
export interface VerifiableClaim {
  kind: 'amount' | 'count' | 'percent' | 'date' | 'merchant' | 'duration'
  value: string | number      // canonical form
  alt_forms: string[]         // accepted renderings ("485.58", "€485.58", "486")
  source_tx_ids?: string[]    // provenance for audit (optional, not all claims have tx ids)
}

export interface Evidence {
  source: EvidenceSource
  // Short factual hook for ranking + Opus brief. Not shown to user verbatim.
  headline: string
  // 0-1 — combined surprise × emotion × actionability. Top-level driver of
  // tier classification. >= 0.7 trips Tier 1.
  wow_score: number
  // Optional per-archetype boost. Empty record means archetype-agnostic.
  archetype_affinity?: Partial<Record<string, number>>
  // The grounded fact pool Opus may quote from.
  verifiable_claims: VerifiableClaim[]
  // Comparators / scale facts (income, monthly avg, etc.) the author may
  // reference for resonance. Numbers here also get added to the claim pool
  // by the validator so e.g. "rent" can be cited.
  context_facts: Record<string, string | number>
  // Free-form natural-language brief for Opus, e.g. "The user paid the same
  // €485.58 to Iberia twice on 24-Jan — looks like a double-billing."
  brief: string
  // For dedupe + tracing. Stable per-user-per-evidence so we don't re-issue
  // the same evidence twice.
  evidence_id: string
  // Maps to active_experiments.observation_type's constrained enum so we
  // don't need a DB migration. The real source lives in `source` above and
  // gets stored in pattern_template_key.
  legacy_observation_type: ObservationType
}

// Output of generation step (Opus). Mirrors `WowMomentResult` but tracks
// which tier and evidence produced it so the route + token signing layer
// can attach metadata downstream.
export interface AuthoredWowMoment {
  tier: Tier
  evidence_id: string
  observed: string
  named: string
  asked: string
  proposed: string
  narrative: string  // synthesised from observed for the fallback rendering path
}
