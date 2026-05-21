// The 10 experiment templates the engine can propose. Each is keyed to one or
// more canonical pattern-detector IDs (see lib/analytics/pattern-detectors.ts)
// and carries the dimensional scoring inputs that feed lib/experiments/scoring.ts.
//
// Two templates from the original v2.3 spec (no_eat_out_week, cash_only_week)
// are deliberately dropped: they relied on detector IDs that don't exist
// (eating_out_heavy, multi_card_fragmentation). Adding them is a follow-up
// session — write the detector first, then the template.

export type GoalType = 'debt_clearance' | 'savings' | 'investment' | 'general';

// The five back-compat values from the existing proposed_experiments enum.
// Catalog rows must still set experiment_type so the old constraint passes.
export type LegacyExperimentType =
  | 'reduce_merchant'
  | 'pause_recurring'
  | 'consolidate_category'
  | 'cap_category'
  | 'redirect_to_goal';

export type EffortBand = 'low' | 'medium' | 'high';
export type ReachBand = 'narrow' | 'broad';
export type Measurability = 'self_report_clear' | 'self_report_fuzzy';
export type ValueQuadrant = 'foundation' | 'investment' | 'leak' | 'burden';

export interface TargetMetricSchema {
  kind: 'amount_under' | 'count_at_most' | 'completed';
  field?: 'category' | 'merchant' | 'subscription' | 'transfer' | 'balance';
  // Optional default threshold; the proposing layer is expected to fill in a
  // user-specific value before persisting.
  default_threshold?: number;
}

export interface ExperimentTemplate {
  id: string;
  experiment_type: LegacyExperimentType;
  title_template: string;
  hypothesis: string;
  success_criterion_template: string;
  duration_days: number;
  target_metric: TargetMetricSchema;
  /** Canonical detector IDs from pattern-detectors.ts. */
  trigger_patterns: string[];
  goal_affinity: Partial<Record<GoalType, number>>;
  effort: EffortBand;
  reach: ReachBand;
  measurability: Measurability;
  /**
   * When true, the proposal layer should skip this template if the user's
   * income signal confidence (computeIncomeSignal) is below
   * INCOME_SIGNAL_THRESHOLD. No current template sets this — the field
   * exists so future income-cadence-dependent templates can opt in without
   * a schema change.
   */
  requires_income_signal?: boolean;
  /**
   * Spending category slugs this template targets (canonical slugs from
   * categories.id). The values_alignment scoring dimension reads the user's
   * per-category Value Map distribution against these. Templates whose
   * target is dynamic (cap_top_category, merchant_cap) use 'DYNAMIC' — the
   * scoring engine resolves the real category from pattern data at proposal
   * time. Templates that don't target a category leave this empty and score
   * neutrally (0.5).
   */
  affects_categories?: string[];
  /**
   * Hint about the quadrant this experiment is fundamentally aimed at.
   *   'leak' — explicit leak hunting; lifts values_alignment when user has
   *            confirmed any leaks anywhere.
   *   'foundation' / 'investment' — rare; shoring up essentials or
   *            protecting investments.
   * Omit when quadrant-neutral.
   */
  quadrant_intent?: ValueQuadrant;
}

export const EXPERIMENT_TEMPLATES: readonly ExperimentTemplate[] = [
  {
    id: 'subscription_audit',
    experiment_type: 'pause_recurring',
    title_template: 'Cancel one subscription this week',
    hypothesis: 'Subscription density grows silently; cancelling one creates a permanent monthly redirect.',
    success_criterion_template: 'One subscription cancelled and confirmed',
    duration_days: 7,
    target_metric: { kind: 'completed', field: 'subscription' },
    trigger_patterns: ['recurring_expense_total'],
    goal_affinity: { debt_clearance: 0.8, savings: 0.85, investment: 0.7, general: 0.75 },
    effort: 'low',
    reach: 'narrow',
    measurability: 'self_report_clear',
    affects_categories: ['subscriptions'],
  },
  {
    id: 'merchant_cap',
    experiment_type: 'reduce_merchant',
    title_template: 'Visit your top merchant at most twice this week',
    hypothesis: 'A single high-frequency merchant carries disproportionate weight. Capping visits surfaces the trigger.',
    success_criterion_template: 'At most 2 transactions at your top merchant for 7 days',
    duration_days: 7,
    target_metric: { kind: 'count_at_most', field: 'merchant', default_threshold: 2 },
    trigger_patterns: ['merchant_fragmentation', 'category_concentration'],
    goal_affinity: { debt_clearance: 0.75, savings: 0.75, investment: 0.6, general: 0.7 },
    effort: 'medium',
    reach: 'narrow',
    measurability: 'self_report_clear',
    affects_categories: ['DYNAMIC'],
  },
  {
    id: 'convenience_swap',
    experiment_type: 'consolidate_category',
    title_template: 'Swap one convenience purchase for a planned one this week',
    hypothesis: 'Convenience spend is the cheapest behaviour to flip. One swap proves the pattern is movable.',
    success_criterion_template: 'At least one convenience transaction swapped for a planned alternative',
    duration_days: 7,
    target_metric: { kind: 'completed' },
    trigger_patterns: ['convenience_vs_planned'],
    goal_affinity: { debt_clearance: 0.7, savings: 0.75, investment: 0.6, general: 0.7 },
    effort: 'low',
    reach: 'broad',
    measurability: 'self_report_fuzzy',
    affects_categories: ['groceries', 'eat_drinking_out'],
  },
  {
    id: 'weekend_cap',
    experiment_type: 'cap_category',
    title_template: 'Cap your weekend spend this weekend',
    hypothesis: 'Weekend skew distorts the week; a single weekend cap exposes whether the rest of the week can hold.',
    success_criterion_template: 'Weekend (Fri-Sun) discretionary spend under the agreed cap',
    duration_days: 3,
    target_metric: { kind: 'amount_under', field: 'category' },
    trigger_patterns: ['day_of_week_skew'],
    goal_affinity: { debt_clearance: 0.7, savings: 0.75, investment: 0.55, general: 0.7 },
    effort: 'medium',
    reach: 'broad',
    measurability: 'self_report_clear',
    affects_categories: ['eat_drinking_out', 'entertainment'],
  },
  {
    id: 'cap_top_category',
    experiment_type: 'cap_category',
    title_template: 'Cap your top spending category this month',
    hypothesis: 'A hard ceiling on the dominant category proves how much of it is choice vs. necessity.',
    success_criterion_template: 'Spend in the top category stays under the agreed monthly cap',
    duration_days: 30,
    target_metric: { kind: 'amount_under', field: 'category' },
    trigger_patterns: ['category_concentration'],
    goal_affinity: { debt_clearance: 0.8, savings: 0.85, investment: 0.65, general: 0.75 },
    effort: 'medium',
    reach: 'broad',
    measurability: 'self_report_clear',
    affects_categories: ['DYNAMIC'],
  },
  {
    id: 'velocity_brake',
    experiment_type: 'cap_category',
    title_template: 'Take two zero-spend days this week',
    hypothesis: 'Every-day spending becomes the rhythm. Two zero-spend days break it without forcing scarcity.',
    success_criterion_template: '2 days with no card or cash transactions',
    duration_days: 7,
    target_metric: { kind: 'count_at_most', default_threshold: 5 },
    trigger_patterns: ['spending_velocity'],
    goal_affinity: { debt_clearance: 0.85, savings: 0.85, investment: 0.65, general: 0.75 },
    effort: 'medium',
    reach: 'broad',
    measurability: 'self_report_clear',
  },
  {
    id: 'value_leak_pause',
    experiment_type: 'reduce_merchant',
    title_template: 'Pause your top Leak category for two weeks',
    hypothesis: "Your own Value Map flagged this spend as a Leak. Two weeks off is the lowest-friction redirect.",
    success_criterion_template: 'Zero transactions in the chosen Leak category for 14 days',
    duration_days: 14,
    target_metric: { kind: 'count_at_most', field: 'category', default_threshold: 0 },
    trigger_patterns: ['value_map_gap'],
    goal_affinity: { debt_clearance: 0.85, savings: 0.85, investment: 0.7, general: 0.75 },
    effort: 'medium',
    reach: 'narrow',
    measurability: 'self_report_clear',
    quadrant_intent: 'leak',
  },
  {
    id: 'redirect_windfall_to_goal',
    experiment_type: 'redirect_to_goal',
    title_template: 'Move a fixed amount toward your goal on payday',
    hypothesis: "Pay-yourself-first beats willpower. Moving money before it's seen is the cleanest structural fix.",
    success_criterion_template: 'Agreed amount transferred toward goal on payday, not pulled back',
    duration_days: 30,
    target_metric: { kind: 'amount_under', field: 'transfer' },
    trigger_patterns: ['income_detected', 'balance_trajectory'],
    goal_affinity: { debt_clearance: 0.95, savings: 0.95, investment: 0.85, general: 0.65 },
    effort: 'low',
    reach: 'broad',
    measurability: 'self_report_clear',
  },
  {
    id: 'creep_reverse',
    experiment_type: 'cap_category',
    title_template: 'Hold this month under last month total',
    hypothesis: 'Month-over-month creep is invisible until you name it. Pulling under last month resets the baseline.',
    success_criterion_template: 'Total discretionary spend this month under last month total',
    duration_days: 30,
    target_metric: { kind: 'amount_under' },
    trigger_patterns: ['month_over_month_trend'],
    goal_affinity: { debt_clearance: 0.8, savings: 0.8, investment: 0.65, general: 0.75 },
    effort: 'high',
    reach: 'broad',
    measurability: 'self_report_clear',
  },
  {
    id: 'sawtooth_smooth',
    experiment_type: 'redirect_to_goal',
    title_template: 'Hold a buffer at the end of this pay cycle',
    hypothesis: 'Sawtooth balances reset to zero by habit. A small surplus held back becomes permanent.',
    success_criterion_template: 'Agreed buffer still in the account at next payday',
    duration_days: 14,
    target_metric: { kind: 'amount_under', field: 'balance' },
    trigger_patterns: ['balance_trajectory'],
    goal_affinity: { debt_clearance: 0.9, savings: 0.95, investment: 0.75, general: 0.65 },
    effort: 'medium',
    reach: 'broad',
    measurability: 'self_report_clear',
  },
] as const;

export function templatesForPattern(patternId: string): ExperimentTemplate[] {
  return EXPERIMENT_TEMPLATES.filter((t) => t.trigger_patterns.includes(patternId));
}

export function findTemplate(id: string): ExperimentTemplate | null {
  return EXPERIMENT_TEMPLATES.find((t) => t.id === id) ?? null;
}
