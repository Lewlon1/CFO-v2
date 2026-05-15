/**
 * Tiered ranking for action items returned by get_action_items.
 *
 * Selection rule:
 *   Tier 0 — goal_id matches the user's primary goal (most relevant).
 *   Tier 1 — goal_id is null AND category is goal-adjacent
 *            (goal_setting | savings_transfer).
 *   Tier 2 — everything else.
 *
 * Within each tier: order by priority (high → medium → low → null),
 * then created_at DESC.
 *
 * Heuristic, not projection. A future €-impact projection (after the
 * progress engine lands) would replace tier 0/1 with a modelled score
 * against `potential_savings`; the current shape is documented in
 * BACKLOG.md.
 */

export type RankableActionItem = {
  id: string;
  category: string | null;
  priority: string | null;
  created_at: string | null;
  goal_id: string | null;
};

const GOAL_ADJACENT_CATEGORIES = new Set(['goal_setting', 'savings_transfer']);
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function tierFor(item: RankableActionItem, primaryGoalId: string | null): number {
  if (primaryGoalId && item.goal_id === primaryGoalId) return 0;
  if (!item.goal_id && item.category && GOAL_ADJACENT_CATEGORIES.has(item.category)) return 1;
  return 2;
}

export function priorityRank(priority: string | null): number {
  if (priority != null && PRIORITY_RANK[priority] != null) return PRIORITY_RANK[priority];
  return 3;
}

export function rankActionItems<T extends RankableActionItem>(
  items: T[],
  primaryGoalId: string | null,
): T[] {
  return items.slice().sort((a, b) => {
    const tierDiff = tierFor(a, primaryGoalId) - tierFor(b, primaryGoalId);
    if (tierDiff !== 0) return tierDiff;
    const prioDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (prioDiff !== 0) return prioDiff;
    return (b.created_at ?? '').localeCompare(a.created_at ?? '');
  });
}
