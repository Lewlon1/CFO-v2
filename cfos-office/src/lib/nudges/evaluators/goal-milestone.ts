import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluateGoalMilestones(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: goals } = await supabase
    .from('goals')
    .select('id, name, target_amount, current_amount, target_date')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('target_amount', 0);

  if (!goals) return;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', userId)
    .single();

  const currency = profile?.primary_currency ?? 'EUR';
  const milestones = [25, 50, 75, 100];

  for (const goal of goals) {
    const currentAmount = goal.current_amount ?? 0;
    // Negative balances (from withdrawal contributions) skip milestone
    // evaluation — a "you're behind your starting point" goal shouldn't
    // trigger a celebratory milestone nudge.
    if (currentAmount < 0) continue;
    const percentage = Math.round((currentAmount / goal.target_amount) * 100);

    const crossedMilestone = milestones.filter(m => percentage >= m).pop();
    if (!crossedMilestone) continue;

    await createNudge(supabase, {
      userId,
      type: 'goal_milestone',
      variables: {
        percentage: crossedMilestone,
        goal_name: goal.name,
        current: (goal.current_amount ?? 0).toFixed(2),
        target: goal.target_amount.toFixed(2),
        currency,
        target_date: goal.target_date
          ? new Date(goal.target_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
          : 'your target date',
      },
      scopeKey: `goal_milestone:${goal.id}:${crossedMilestone}`,
    });
  }
}
