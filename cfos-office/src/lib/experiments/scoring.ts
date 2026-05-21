// Pure scoring engine for the experiment catalog. Five dimensions:
//   goal_alignment 0.35, measurability 0.20, effort 0.15, reach 0.15,
//   values_alignment 0.15.
//
// values_alignment reads the user's per-category Value Map distribution via
// resolveValuesAlignment() (lib/value-map/value-profile.ts). When no profile
// is plumbed (legacy callers, no-VM users) the dimension scores neutral 0.5
// — ranking degrades to v2.3 modulo the uniform weight shift.
//
// The alias map exists because the original v2.3 spec used a few pattern-ID
// names that don't match the canonical detectors in pattern-detectors.ts.
// canonicalisePatternId() normalises both sides so a template authored against
// 'value_map_leak' still matches the 'value_map_gap' detector.

import type {
  EffortBand,
  ExperimentTemplate,
  GoalType,
  Measurability,
  ReachBand,
} from './templates';

export const SCORING_WEIGHTS = {
  goal_alignment: 0.35,
  measurability: 0.2,
  effort: 0.15,
  reach: 0.15,
  values_alignment: 0.15,
} as const;

export const NEUTRAL_VALUES_ALIGNMENT = 0.5;

// Boot-time guard. Catches silent misconfiguration the moment the module loads
// rather than at the first user's first insight.
{
  const sum =
    SCORING_WEIGHTS.goal_alignment +
    SCORING_WEIGHTS.measurability +
    SCORING_WEIGHTS.effort +
    SCORING_WEIGHTS.reach +
    SCORING_WEIGHTS.values_alignment;
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(
      `SCORING_WEIGHTS must sum to 1, got ${sum}. Update the weights or this assertion.`,
    );
  }
}

// Map non-canonical spec aliases to the canonical detector IDs in
// pattern-detectors.ts. Catalog templates already use canonical IDs, but
// callers passing alias names are tolerated.
const PATTERN_ALIAS: Record<string, string> = {
  recurring_bills_density: 'recurring_expense_total',
  merchant_concentration: 'merchant_fragmentation',
  value_map_leak: 'value_map_gap',
  income_stable: 'income_detected',
};

export function canonicalisePatternId(id: string): string {
  return PATTERN_ALIAS[id] ?? id;
}

const EFFORT_VALUE: Record<EffortBand, number> = {
  low: 1,
  medium: 0.6,
  high: 0.3,
};

const REACH_VALUE: Record<ReachBand, number> = {
  narrow: 0.5,
  broad: 1,
};

const MEASURABILITY_VALUE: Record<Measurability, number> = {
  self_report_clear: 1,
  self_report_fuzzy: 0.6,
};

const NEUTRAL_GOAL_ALIGNMENT = 0.5;
const UNLISTED_GOAL_ALIGNMENT = 0.3;

export interface ScoringBreakdown {
  goal_alignment: number;
  measurability: number;
  effort: number;
  reach: number;
  values_alignment: number;
}

export interface ScoredCandidate {
  template_id: string;
  source_pattern_id: string;
  score: number;
  breakdown: ScoringBreakdown;
}

export interface CandidateInput {
  template: ExperimentTemplate;
  patternId: string;
  goalType: GoalType | null;
}

export function scoreCandidate(c: CandidateInput): ScoredCandidate {
  const canonical = canonicalisePatternId(c.patternId);

  const goal_alignment =
    c.goalType === null
      ? NEUTRAL_GOAL_ALIGNMENT
      : (c.template.goal_affinity[c.goalType] ?? UNLISTED_GOAL_ALIGNMENT);

  // Phase 4 will replace this with the real resolveValuesAlignment() call
  // once UserValueProfile is plumbed through. Until then, the dimension
  // scores neutral so ranking degrades to v2.3 modulo the uniform weight
  // shift.
  const values_alignment = NEUTRAL_VALUES_ALIGNMENT;

  const breakdown: ScoringBreakdown = {
    goal_alignment,
    measurability: MEASURABILITY_VALUE[c.template.measurability],
    effort: EFFORT_VALUE[c.template.effort],
    reach: REACH_VALUE[c.template.reach],
    values_alignment,
  };

  const score =
    breakdown.goal_alignment * SCORING_WEIGHTS.goal_alignment +
    breakdown.measurability * SCORING_WEIGHTS.measurability +
    breakdown.effort * SCORING_WEIGHTS.effort +
    breakdown.reach * SCORING_WEIGHTS.reach +
    breakdown.values_alignment * SCORING_WEIGHTS.values_alignment;

  return {
    template_id: c.template.id,
    source_pattern_id: canonical,
    score,
    breakdown,
  };
}

export interface RankInput {
  templates: readonly ExperimentTemplate[];
  detectedPatternIds: readonly string[];
  goalType: GoalType | null;
  excludedTemplateIds?: ReadonlySet<string>;
}

// Rank by score descending. For each (template, pattern) pair where the
// template lists the pattern as a trigger, score once; if a template is
// triggered by multiple detected patterns, keep the highest-scoring instance.
export function rankCandidates(input: RankInput): ScoredCandidate[] {
  const excluded = input.excludedTemplateIds ?? new Set<string>();
  const canonicalDetected = new Set(input.detectedPatternIds.map(canonicalisePatternId));

  const bestByTemplate = new Map<string, ScoredCandidate>();

  for (const template of input.templates) {
    if (excluded.has(template.id)) continue;

    for (const trigger of template.trigger_patterns) {
      const canonicalTrigger = canonicalisePatternId(trigger);
      if (!canonicalDetected.has(canonicalTrigger)) continue;

      const scored = scoreCandidate({
        template,
        patternId: canonicalTrigger,
        goalType: input.goalType,
      });

      const existing = bestByTemplate.get(template.id);
      if (!existing || scored.score > existing.score) {
        bestByTemplate.set(template.id, scored);
      }
    }
  }

  return [...bestByTemplate.values()].sort((a, b) => b.score - a.score);
}
