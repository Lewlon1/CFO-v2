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
