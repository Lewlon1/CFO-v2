import { describe, expect, it } from 'vitest';

import { EXPERIMENT_TEMPLATES, findTemplate } from '../templates';
import type { ExperimentTemplate, GoalType } from '../templates';
import {
  SCORING_WEIGHTS,
  canonicalisePatternId,
  rankCandidates,
  scoreCandidate,
} from '../scoring';

function pickTemplate(id: string): ExperimentTemplate {
  const t = findTemplate(id);
  if (!t) throw new Error(`template ${id} missing from catalog`);
  return t;
}

describe('scoring weights', () => {
  it('sum to 1', () => {
    const total =
      SCORING_WEIGHTS.goal_alignment +
      SCORING_WEIGHTS.measurability +
      SCORING_WEIGHTS.effort +
      SCORING_WEIGHTS.reach +
      SCORING_WEIGHTS.values_alignment;
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('canonicalisePatternId', () => {
  it('maps spec aliases onto canonical detector ids', () => {
    expect(canonicalisePatternId('recurring_bills_density')).toBe('recurring_expense_total');
    expect(canonicalisePatternId('merchant_concentration')).toBe('merchant_fragmentation');
    expect(canonicalisePatternId('value_map_leak')).toBe('value_map_gap');
    expect(canonicalisePatternId('income_stable')).toBe('income_detected');
  });

  it('passes canonical ids through unchanged', () => {
    expect(canonicalisePatternId('balance_trajectory')).toBe('balance_trajectory');
    expect(canonicalisePatternId('spending_velocity')).toBe('spending_velocity');
  });
});

describe('scoreCandidate', () => {
  it('uses neutral 0.5 alignment when goalType is null', () => {
    const scored = scoreCandidate({
      template: pickTemplate('subscription_audit'),
      patternId: 'recurring_expense_total',
      goalType: null,
    });
    expect(scored.breakdown.goal_alignment).toBe(0.5);
  });

  it('uses the affinity value when goalType is listed', () => {
    const template = pickTemplate('redirect_windfall_to_goal');
    const scored = scoreCandidate({
      template,
      patternId: 'income_detected',
      goalType: 'debt_clearance',
    });
    expect(scored.breakdown.goal_alignment).toBe(template.goal_affinity.debt_clearance);
  });

  it('falls back to 0.3 when goalType is set but absent from the template affinity', () => {
    const template: ExperimentTemplate = {
      ...pickTemplate('subscription_audit'),
      goal_affinity: { savings: 0.9 },
    };
    const scored = scoreCandidate({
      template,
      patternId: 'recurring_expense_total',
      goalType: 'debt_clearance',
    });
    expect(scored.breakdown.goal_alignment).toBeCloseTo(0.3, 10);
  });

  it('is deterministic for identical inputs', () => {
    const args = {
      template: pickTemplate('cap_top_category'),
      patternId: 'category_concentration',
      goalType: 'savings' as GoalType,
    };
    const a = scoreCandidate(args);
    const b = scoreCandidate(args);
    expect(a).toEqual(b);
  });

  it('records the canonical pattern id on the result', () => {
    const scored = scoreCandidate({
      template: pickTemplate('value_leak_pause'),
      patternId: 'value_map_leak', // alias
      goalType: 'general',
    });
    expect(scored.source_pattern_id).toBe('value_map_gap');
  });
});

describe('rankCandidates', () => {
  it('returns templates ordered by score descending', () => {
    const ranked = rankCandidates({
      templates: EXPERIMENT_TEMPLATES,
      detectedPatternIds: [
        'recurring_expense_total',
        'category_concentration',
        'balance_trajectory',
      ],
      goalType: 'debt_clearance',
    });

    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it('excludes templates by id', () => {
    const ranked = rankCandidates({
      templates: EXPERIMENT_TEMPLATES,
      detectedPatternIds: ['recurring_expense_total'],
      goalType: 'general',
      excludedTemplateIds: new Set(['subscription_audit']),
    });
    expect(ranked.find((c) => c.template_id === 'subscription_audit')).toBeUndefined();
  });

  it('emits at most one row per template even when multiple triggers fire', () => {
    const ranked = rankCandidates({
      templates: EXPERIMENT_TEMPLATES,
      detectedPatternIds: ['income_detected', 'balance_trajectory'],
      goalType: 'savings',
    });
    const ids = ranked.map((c) => c.template_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('promotes goal-aligned templates over unrelated ones', () => {
    // With a debt-clearance goal and both income_detected + recurring_expense_total
    // patterns detected, redirect_windfall_to_goal should outrank subscription_audit.
    const ranked = rankCandidates({
      templates: EXPERIMENT_TEMPLATES,
      detectedPatternIds: ['income_detected', 'recurring_expense_total'],
      goalType: 'debt_clearance',
    });
    const redirectIdx = ranked.findIndex((c) => c.template_id === 'redirect_windfall_to_goal');
    const subscriptionIdx = ranked.findIndex((c) => c.template_id === 'subscription_audit');
    expect(redirectIdx).toBeGreaterThanOrEqual(0);
    expect(subscriptionIdx).toBeGreaterThanOrEqual(0);
    expect(redirectIdx).toBeLessThan(subscriptionIdx);
  });

  it('returns empty when no detected pattern matches any template', () => {
    const ranked = rankCandidates({
      templates: EXPERIMENT_TEMPLATES,
      detectedPatternIds: ['nonexistent_pattern_xyz'],
      goalType: 'debt_clearance',
    });
    expect(ranked).toEqual([]);
  });
});
