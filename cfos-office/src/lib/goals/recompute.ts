import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/ai/tools/types';
import { computePaceAndOnTrack } from './pace';

export interface RecomputedGoal {
  id: string;
  current_amount: number;
  target_amount: number;
  target_date: string | null;
  monthly_required_saving: number | null;
  on_track: boolean | null;
  status: string;
  is_overdue: boolean;
}

export interface RecomputeUserResult {
  goalsTouched: number;
  durationMs: number;
}

function buildToolContext(supabase: SupabaseClient, userId: string): ToolContext {
  // Helpers loaded by computePaceAndOnTrack only read ctx.supabase and ctx.userId
  // — conversationId and currency are unused on this path. The empty strings
  // are placeholders to satisfy the type, never read.
  return { supabase, userId, conversationId: '', currency: '' };
}

function deriveOverdue(goal: { target_date: string | null; status: string; current_amount: number; target_amount: number }): boolean {
  if (!goal.target_date) return false;
  if (goal.status !== 'active') return false;
  if (goal.current_amount >= goal.target_amount) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(goal.target_date).getTime() < today.getTime();
}

// Recomputes one goal in three steps:
//   1. Atomically sets current_amount = SUM(active contributions). The
//      defensive guard in the SQL function leaves current_amount alone if the
//      goal has zero contributions and non-zero current_amount (protects
//      against a failed seed insert).
//   2. Computes monthly_required_saving and on_track via the shared pace fn
//      against the post-update current_amount.
//   3. Writes the two computed columns + stamps user_profiles.goals_last_synced_at.
//
// Throws on DB errors so callers can decide whether to surface or swallow.
export async function recomputeGoal(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
): Promise<RecomputedGoal | null> {
  const { data: updated, error: updateErr } = await supabase
    .rpc('recompute_goal_current_amount', { p_goal_id: goalId });

  if (updateErr) {
    throw new Error(`recompute_goal_current_amount failed: ${updateErr.message}`);
  }

  // The RPC's defensive guard may skip the row (zero contributions, non-zero
  // current_amount). In that case we read the goal directly so we still
  // compute pace/on_track against the stored value.
  let row = Array.isArray(updated) && updated.length > 0 ? updated[0] : null;
  if (!row) {
    const { data: fetched, error: fetchErr } = await supabase
      .from('goals')
      .select('id, current_amount, target_amount, target_date, status')
      .eq('id', goalId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();
    if (fetchErr) throw new Error(`fetch goal after recompute failed: ${fetchErr.message}`);
    if (!fetched) return null;
    row = fetched;
  }

  if (row.status !== 'active') {
    return {
      id: row.id,
      current_amount: Number(row.current_amount ?? 0),
      target_amount: Number(row.target_amount ?? 0),
      target_date: row.target_date,
      monthly_required_saving: null,
      on_track: null,
      status: row.status,
      is_overdue: false,
    };
  }

  const ctx = buildToolContext(supabase, userId);
  const pace = await computePaceAndOnTrack(ctx, {
    current_amount: Number(row.current_amount ?? 0),
    target_amount: Number(row.target_amount ?? 0),
    target_date: row.target_date,
  });

  const { error: writeErr } = await supabase
    .from('goals')
    .update({
      monthly_required_saving: pace.monthly_required_saving,
      on_track: pace.on_track,
    })
    .eq('id', goalId)
    .eq('user_id', userId);
  if (writeErr) throw new Error(`update goal pace/on_track failed: ${writeErr.message}`);

  await supabase
    .from('user_profiles')
    .update({ goals_last_synced_at: new Date().toISOString() })
    .eq('id', userId);

  const currentAmount = Number(row.current_amount ?? 0);
  const targetAmount = Number(row.target_amount ?? 0);

  return {
    id: row.id,
    current_amount: currentAmount,
    target_amount: targetAmount,
    target_date: row.target_date,
    monthly_required_saving: pace.monthly_required_saving,
    on_track: pace.on_track,
    status: row.status,
    is_overdue: deriveOverdue({
      target_date: row.target_date,
      status: row.status,
      current_amount: currentAmount,
      target_amount: targetAmount,
    }),
  };
}

const DEFAULT_RECOMPUTE_TTL_MS = 30 * 60 * 1000;

// TTL-gated wrapper for the login hook. Skips the recompute if the user's
// goals_last_synced_at is fresher than ttlMs. Lives here (not in the layout)
// so the layout's render stays free of Date.now() / new Date() calls that
// react-hooks/refs flags as impure.
export async function recomputeIfStale(
  supabase: SupabaseClient,
  userId: string,
  lastSyncedIso: string | null,
  ttlMs: number = DEFAULT_RECOMPUTE_TTL_MS,
): Promise<RecomputeUserResult | null> {
  const lastSynced = lastSyncedIso ? new Date(lastSyncedIso).getTime() : null;
  const isStale = lastSynced == null || (Date.now() - lastSynced) > ttlMs;
  if (!isStale) return null;
  return recomputeUserGoals(supabase, userId);
}

// Iterates over all active, non-deleted goals for the user. Sequential —
// a user has a handful of goals at most. Returns a small summary used for
// observability (single console.info line per invocation, not per goal).
//
// Throws on the first goal failure so the caller can log + skip rendering
// updated numbers. The login-hook caller wraps this in a try/catch and
// silently degrades to last-known numbers.
export async function recomputeUserGoals(
  supabase: SupabaseClient,
  userId: string,
): Promise<RecomputeUserResult> {
  const start = Date.now();

  const { data: goals, error } = await supabase
    .from('goals')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null);
  if (error) throw new Error(`load active goals failed: ${error.message}`);

  let goalsTouched = 0;
  for (const goal of goals ?? []) {
    const result = await recomputeGoal(supabase, userId, goal.id);
    if (result) goalsTouched += 1;
  }

  // Stamp goals_last_synced_at once at the end too — covers the zero-goals
  // case where recomputeGoal never runs.
  await supabase
    .from('user_profiles')
    .update({ goals_last_synced_at: new Date().toISOString() })
    .eq('id', userId);

  const durationMs = Date.now() - start;
  console.info('[goals-recompute]', { userId, goalsTouched, durationMs });
  return { goalsTouched, durationMs };
}
