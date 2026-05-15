import { describe, expect, it } from 'vitest';
import { priorityRank, rankActionItems, tierFor } from './action-item-ranking';
import type { RankableActionItem } from './action-item-ranking';

const PRIMARY = 'goal-primary';
const OTHER_GOAL = 'goal-other';

function row(overrides: Partial<RankableActionItem> & { id: string }): RankableActionItem {
  return {
    category: null,
    priority: null,
    created_at: '2026-05-01T00:00:00Z',
    goal_id: null,
    ...overrides,
  };
}

describe('tierFor', () => {
  it('returns 0 when goal_id matches primary goal', () => {
    expect(tierFor(row({ id: 'a', goal_id: PRIMARY }), PRIMARY)).toBe(0);
  });

  it('returns 2 when goal_id is set but does not match primary goal', () => {
    // Linked to a non-primary goal — neither tier 0 nor goal-adjacent fallback.
    expect(tierFor(row({ id: 'b', goal_id: OTHER_GOAL, category: 'goal_setting' }), PRIMARY)).toBe(2);
  });

  it('returns 1 when goal_id is null and category is goal_setting', () => {
    expect(tierFor(row({ id: 'c', category: 'goal_setting' }), PRIMARY)).toBe(1);
  });

  it('returns 1 when goal_id is null and category is savings_transfer', () => {
    expect(tierFor(row({ id: 'd', category: 'savings_transfer' }), PRIMARY)).toBe(1);
  });

  it('returns 2 when goal_id is null and category is unrelated', () => {
    expect(tierFor(row({ id: 'e', category: 'bill_switch' }), PRIMARY)).toBe(2);
  });

  it('returns 2 (no tier-0 possible) when there is no primary goal', () => {
    // A previously-linked action with the primary deleted should fall back.
    expect(tierFor(row({ id: 'f', goal_id: PRIMARY }), null)).toBe(2);
  });

  it('falls back to tier 1 by category when there is no primary goal', () => {
    expect(tierFor(row({ id: 'g', category: 'goal_setting' }), null)).toBe(1);
  });
});

describe('priorityRank', () => {
  it('ranks high < medium < low', () => {
    expect(priorityRank('high')).toBe(0);
    expect(priorityRank('medium')).toBe(1);
    expect(priorityRank('low')).toBe(2);
  });

  it('ranks null and unknown values last', () => {
    expect(priorityRank(null)).toBe(3);
    expect(priorityRank('urgent')).toBe(3);
  });
});

describe('rankActionItems', () => {
  it('returns goal-matched items first, then category fallback, then rest', () => {
    const items: RankableActionItem[] = [
      row({ id: 'other', category: 'bill_switch', priority: 'high', created_at: '2026-05-10T00:00:00Z' }),
      row({ id: 'fallback', category: 'goal_setting', priority: 'low', created_at: '2026-05-09T00:00:00Z' }),
      row({ id: 'matched', goal_id: PRIMARY, priority: 'low', created_at: '2026-05-01T00:00:00Z' }),
    ];

    const ranked = rankActionItems(items, PRIMARY);

    expect(ranked.map((i) => i.id)).toEqual(['matched', 'fallback', 'other']);
  });

  it('orders within a tier by priority then recency', () => {
    const items: RankableActionItem[] = [
      row({ id: 'medium-old', goal_id: PRIMARY, priority: 'medium', created_at: '2026-05-01T00:00:00Z' }),
      row({ id: 'high-old', goal_id: PRIMARY, priority: 'high', created_at: '2026-05-01T00:00:00Z' }),
      row({ id: 'high-new', goal_id: PRIMARY, priority: 'high', created_at: '2026-05-10T00:00:00Z' }),
      row({ id: 'low-new', goal_id: PRIMARY, priority: 'low', created_at: '2026-05-15T00:00:00Z' }),
    ];

    const ranked = rankActionItems(items, PRIMARY);

    expect(ranked.map((i) => i.id)).toEqual(['high-new', 'high-old', 'medium-old', 'low-new']);
  });

  it('treats action items linked to a non-primary goal as tier 2', () => {
    // A user with multiple goals: an action tied to a non-primary goal should
    // not get tier-1 treatment via category fallback either (its goal_id is set).
    const items: RankableActionItem[] = [
      row({
        id: 'non-primary-link',
        goal_id: OTHER_GOAL,
        category: 'goal_setting',
        priority: 'high',
        created_at: '2026-05-15T00:00:00Z',
      }),
      row({
        id: 'category-fallback',
        category: 'goal_setting',
        priority: 'low',
        created_at: '2026-05-01T00:00:00Z',
      }),
    ];

    const ranked = rankActionItems(items, PRIMARY);

    expect(ranked.map((i) => i.id)).toEqual(['category-fallback', 'non-primary-link']);
  });

  it('returns sensible order when primary goal is null', () => {
    // No primary goal: tier 0 is impossible, so category fallback decides the lead.
    const items: RankableActionItem[] = [
      row({ id: 'plain', priority: 'high', category: 'bill_switch', created_at: '2026-05-10T00:00:00Z' }),
      row({ id: 'fallback', priority: 'medium', category: 'savings_transfer', created_at: '2026-05-01T00:00:00Z' }),
    ];

    const ranked = rankActionItems(items, null);

    expect(ranked.map((i) => i.id)).toEqual(['fallback', 'plain']);
  });

  it('does not mutate the input array', () => {
    const items: RankableActionItem[] = [
      row({ id: 'a', priority: 'low' }),
      row({ id: 'b', priority: 'high' }),
    ];
    const inputCopy = [...items];

    rankActionItems(items, PRIMARY);

    expect(items.map((i) => i.id)).toEqual(inputCopy.map((i) => i.id));
  });
});
