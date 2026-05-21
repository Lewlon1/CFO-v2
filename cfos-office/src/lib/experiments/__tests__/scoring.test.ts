import { describe, expect, it } from 'vitest';

import { EXPERIMENT_TEMPLATES, findTemplate } from '../templates';
import type { ExperimentTemplate, GoalType } from '../templates';
import {
  SCORING_WEIGHTS,
  canonicalisePatternId,
  rankCandidates,
  scoreCandidate,
} from '../scoring';
import type { UserValueProfile } from '@/lib/value-map/value-profile';

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

describe('values_alignment dimension', () => {
  const lewisProfile: UserValueProfile = {
    by_category: {
      eat_drinking_out: { foundation: 0.7, investment: 0.1, leak: 0.1, burden: 0.1 },
    },
    signal_count: { eat_drinking_out: 12 },
    has_value_map: true,
    has_any_leak_signal: true,
  };

  const dorcasProfile: UserValueProfile = {
    by_category: {
      eat_drinking_out: { foundation: 0.05, investment: 0.05, leak: 0.8, burden: 0.1 },
      entertainment: { foundation: 0.1, investment: 0.05, leak: 0.8, burden: 0.05 },
      subscriptions: { foundation: 0.1, investment: 0, leak: 0.85, burden: 0.05 },
    },
    signal_count: { eat_drinking_out: 12, entertainment: 6, subscriptions: 8 },
    has_value_map: true,
    has_any_leak_signal: true,
  };

  it('drops weekend_cap when dining is Foundation for the user', () => {
    const scored = scoreCandidate({
      template: pickTemplate('weekend_cap'),
      patternId: 'day_of_week_skew',
      goalType: 'savings',
      userValueProfile: lewisProfile,
    });
    expect(scored.breakdown.values_alignment).toBe(0.25);
  });

  it('lifts weekend_cap when dining is Leak for the user', () => {
    const scored = scoreCandidate({
      template: pickTemplate('weekend_cap'),
      patternId: 'day_of_week_skew',
      goalType: 'savings',
      userValueProfile: dorcasProfile,
    });
    expect(scored.breakdown.values_alignment).toBe(0.95);
  });

  it('scores 0.5 when no UserValueProfile is provided', () => {
    const scored = scoreCandidate({
      template: pickTemplate('weekend_cap'),
      patternId: 'day_of_week_skew',
      goalType: 'savings',
    });
    expect(scored.breakdown.values_alignment).toBe(0.5);
  });

  it('flips weekend_cap below subscription_audit for a Foundation-dining user with Leak subscriptions', () => {
    const profile: UserValueProfile = {
      ...lewisProfile,
      by_category: {
        ...lewisProfile.by_category,
        subscriptions: { foundation: 0.1, investment: 0, leak: 0.85, burden: 0.05 },
      },
      signal_count: { ...lewisProfile.signal_count, subscriptions: 8 },
    };
    const wc = scoreCandidate({
      template: pickTemplate('weekend_cap'),
      patternId: 'day_of_week_skew',
      goalType: 'savings',
      userValueProfile: profile,
    });
    const sa = scoreCandidate({
      template: pickTemplate('subscription_audit'),
      patternId: 'recurring_expense_total',
      goalType: 'savings',
      userValueProfile: profile,
    });
    expect(sa.score).toBeGreaterThan(wc.score);
  });

  it('preserves all-neutral 0.5 for users with no Value Map (regression)', () => {
    const result = rankCandidates({
      templates: EXPERIMENT_TEMPLATES,
      detectedPatternIds: ['day_of_week_skew', 'recurring_expense_total'],
      goalType: 'savings',
    });
    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.breakdown.values_alignment).toBe(0.5);
    }
  });

  it('resolves DYNAMIC category from dynamicCategoryByTemplate in rankCandidates', () => {
    const result = rankCandidates({
      templates: EXPERIMENT_TEMPLATES,
      detectedPatternIds: ['category_concentration'],
      goalType: 'savings',
      userValueProfile: dorcasProfile,
      dynamicCategoryByTemplate: new Map([['cap_top_category', 'eat_drinking_out']]),
    });
    const capTop = result.find((r) => r.template_id === 'cap_top_category');
    expect(capTop).toBeDefined();
    expect(capTop!.breakdown.values_alignment).toBe(0.95);
  });
});
