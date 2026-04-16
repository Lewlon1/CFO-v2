// cfos-office/src/lib/analytics/insight-types.ts

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

export type Transaction = Database['public']['Tables']['transactions']['Row'];
export type MonthlySnapshot = Database['public']['Tables']['monthly_snapshots']['Row'];
export type RecurringExpense = Database['public']['Tables']['recurring_expenses']['Row'];
export type ValueMapSession = Database['public']['Tables']['value_map_sessions']['Row'];

/** @deprecated alias kept for call-site compatibility — points at value_map_sessions (archetype lives there) */
export type ValueMapResult = ValueMapSession;

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

export const BLOCKED_AT_FIRST_INSIGHT: DataDependency[] = ['income', 'goals'];

export interface PatternResult {
  id: string;
  score: number;
  layer: InsightLayer;
  data: Record<string, unknown>;
  narrative_prompt: string;
  requires: DataDependency[];
}

export interface DetectorContext {
  supabase: SupabaseClient;
  userId: string;
  transactions: Transaction[];
  valueMap: ValueMapResult | null;
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
  computedAt: string;
}
