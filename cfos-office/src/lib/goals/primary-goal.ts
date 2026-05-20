import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shape of a primary goal returned for home-surface display.
 * Subset of the full `goals` row — only the fields the UI needs.
 * All progress fields (current_amount, monthly_required_saving, on_track)
 * are kept fresh by lib/goals/recompute.ts on the office layout render.
 */
export type PrimaryGoal = {
  id: string
  name: string
  target_amount: number | null
  current_amount: number | null
  target_date: string | null
  monthly_required_saving: number | null
  on_track: boolean | null
  priority: string | null
  created_at: string
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
const rankOf = (p: string | null): number =>
  p != null && PRIORITY_RANK[p] != null ? PRIORITY_RANK[p] : 3

/**
 * Return the single primary goal to feature on the office home, or null.
 *
 * Selection rule:
 *   1. Filter to active, non-soft-deleted goals for the user.
 *   2. Sort by priority (high → medium → low → null), then by created_at DESC.
 *   3. Return the first; null if none.
 *
 * Active-only contract: a user whose only goal is `status='completed'` will
 * receive null here. The detail view (/office/goals) still lists
 * completed goals under its own section.
 *
 * Session 12 imports this same function for CFO prompt context — keep the
 * implementation centralised so the "does this user have a goal" signal does
 * not drift between surfaces.
 */
export async function getPrimaryGoal(
  supabase: SupabaseClient,
  userId: string,
): Promise<PrimaryGoal | null> {
  const { data, error } = await supabase
    .from('goals')
    .select(
      'id, name, target_amount, current_amount, target_date, monthly_required_saving, on_track, priority, created_at',
    )
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null)

  if (error) throw new Error(`getPrimaryGoal: ${error.message}`)
  if (!data || data.length === 0) return null

  return [...(data as PrimaryGoal[])].sort((a, b) => {
    const r = rankOf(a.priority) - rankOf(b.priority)
    if (r !== 0) return r
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })[0]
}
