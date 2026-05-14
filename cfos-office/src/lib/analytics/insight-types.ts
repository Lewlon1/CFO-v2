// cfos-office/src/lib/analytics/insight-types.ts

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

export type Transaction = Database['public']['Tables']['transactions']['Row'];
export type MonthlySnapshot = Database['public']['Tables']['monthly_snapshots']['Row'];
export type RecurringExpense = Database['public']['Tables']['recurring_expenses']['Row'];
export type ValueMapSession = Database['public']['Tables']['value_map_sessions']['Row'];

export type InsightLayer =
  | 'headline'
  | 'gap'
  | 'numbers'
  | 'hidden_pattern'
  | 'action'
  | 'hook';

export type DataDependency =
  | 'transactions'
  | 'value_map'
  | 'multi_month'
  | 'balance_data'
  | 'location_data'
  | 'income_signal'
  | 'income'
  | 'goals';

// Patterns whose dependencies are blocked at first-insight time are skipped
// even if the data exists. We keep 'income' blocked because we never have
// reliable income at first insight. 'goals' used to be blocked too, but we
// now surface a user's stated intent (entry_struggle / goals row) so
// goal-aware patterns can run when there's something to anchor to.
export const BLOCKED_AT_FIRST_INSIGHT: DataDependency[] = ['income'];

// Deterministic experiment attached to a pattern — every number here is
// computed in the detector. Claude quotes the bands verbatim; the UI renders
// the card. See pattern-detectors.ts for the savings math.
export interface Experiment {
  title: string;
  hypothesis: string;
  time_investment: string;
  monthly_saving_low: number;
  monthly_saving_high: number;
  annual_saving_low: number;
  annual_saving_high: number;
  annual_minutes_saved: number | null;
  experiment_prompt: string;
  cta_label: string;
  template_kind: 'grocery_plan' | 'subscription_audit' | 'convenience_swap';
  currency: string;
}

export interface PatternResult {
  id: string;
  score: number;
  layer: InsightLayer;
  data: Record<string, unknown>;
  narrative_prompt: string;
  requires: DataDependency[];
  experiment?: Experiment;
}

export interface DetectorContext {
  supabase: SupabaseClient;
  userId: string;
  transactions: Transaction[];
  valueMap: ValueMapSession | null;
  snapshots: MonthlySnapshot[];
  recurring: RecurringExpense[];
  currency: string;
  country: string | null;
}

export interface PatternDetector {
  id: string;
  layer: InsightLayer;
  requires: DataDependency[];
  detect: (ctx: DetectorContext) => Promise<PatternResult | null> | PatternResult | null;
}

export interface StatCard {
  label: string;
  value: string;
  source_pattern_id: string;
}

export interface Hook {
  type: 'ask_income' | 'ask_goals' | 'ask_value_map' | 'ask_second_month' | 'ask_housing' | 'conclude';
  prompt_for_claude: string;
  suggested_response: string;
}

export type UserIntentSource = 'goal' | 'entry_struggle' | 'portrait';
export type UserIntentStruggleType =
  | 'wealth'
  | 'debt'
  | 'planning'
  | 'free_text'
  | 'dont_know';

export interface UserIntent {
  source: UserIntentSource;
  /** When source = 'entry_struggle', the picked option id. */
  struggleType?: UserIntentStruggleType;
  /** Free-text the user wrote (entry_struggle_text or goal description). */
  text?: string;
  /** Short label used when source = 'goal'. */
  goalName?: string;
}

export interface InsightPayload {
  version: 1;
  userName: string | null;
  country: string | null;
  currency: string;
  monthCount: number;
  transactionCount: number;
  hasValueMap: boolean;
  archetype: string | null;
  disciplineScore: number;
  availableDependencies: DataDependency[];
  layers: Partial<Record<InsightLayer, PatternResult>>;
  statCards: StatCard[];
  hook: Hook;
  suggestedResponses: string[];
  /**
   * What the user has told us they want from this product, resolved from the
   * highest-signal source available. Used to frame the wow moment in chat.
   * Null when nothing is known yet (e.g. a Marcus journey with entry_struggle
   * = 'dont_know' and no goals row).
   */
  userIntent: UserIntent | null;
  computedAt: string;
}

/**
 * A single fact the LLM is allowed to quote verbatim in the first-insight
 * narrative. `text` is the exact string the LLM must echo. `numbers` is the
 * numeric values inside `text` (so the post-LLM validator can check that any
 * number in the narrative appears in at least one allowed fact). `merchants`
 * is the merchant names similarly checkable.
 */
export type QuotableFact = {
  text: string;
  numbers: number[];
  merchants: string[];
};

/** Result of post-LLM validation. */
export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'numbers_not_allowed' | 'merchants_not_allowed';
      offenders: string[];
    };
