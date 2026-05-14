import type { SupabaseClient } from '@supabase/supabase-js';
import { recomputeGoal, type RecomputedGoal } from './recompute';

export interface LogContributionInput {
  goalId: string;
  amount: number;
  note?: string | null;
  kind?: 'manual' | 'seed';
}

export interface LoggedContribution {
  id: string;
  goal_id: string;
  amount: number;
  note: string | null;
  kind: 'manual' | 'seed';
  logged_at: string;
}

export interface LogContributionResult {
  contribution: LoggedContribution;
  goal: RecomputedGoal;
}

// Single shared write path for goal contributions. Used by:
//   - the log_contribution Claude tool
//   - the GoalCard "log contribution" server action
//   - create_goal when seeding a goal with current_amount > 0
//
// Writes the contribution row, then triggers a per-goal recompute so the
// caller's response reflects the new state. Throws on DB error so callers
// handle the failure mode appropriately.
export async function logContribution(
  supabase: SupabaseClient,
  userId: string,
  input: LogContributionInput,
): Promise<LogContributionResult> {
  if (input.amount === 0 || Number.isNaN(input.amount)) {
    throw new Error('Contribution amount must be non-zero');
  }

  const { data: contribution, error: insertErr } = await supabase
    .from('goal_contributions')
    .insert({
      goal_id: input.goalId,
      user_id: userId,
      amount: input.amount,
      note: input.note ?? null,
      kind: input.kind ?? 'manual',
    })
    .select('id, goal_id, amount, note, kind, logged_at')
    .single();

  if (insertErr || !contribution) {
    throw new Error(`log contribution failed: ${insertErr?.message ?? 'unknown error'}`);
  }

  const goal = await recomputeGoal(supabase, userId, input.goalId);
  if (!goal) {
    throw new Error('Goal not found after contribution was logged');
  }

  return {
    contribution: {
      id: contribution.id,
      goal_id: contribution.goal_id,
      amount: Number(contribution.amount),
      note: contribution.note,
      kind: contribution.kind as 'manual' | 'seed',
      logged_at: contribution.logged_at,
    },
    goal,
  };
}
