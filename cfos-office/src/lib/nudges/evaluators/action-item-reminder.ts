import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

// Per-item cadence is enforced by createNudge → canSendNudge against the
// nudges table (scope_key=`action:<id>`, cooldown_hours=168, max_per_month=4).
// This evaluator is intentionally stateless on action_items — no local
// last_nudge_at / nudge_count tracking. Those columns never shipped to the
// deployed schema (only existed in the never-applied 001_initial_schema.sql);
// the previous implementation referenced them and threw PostgrestError 42703
// every Monday.

export async function evaluateActionItemReminders(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: staleActions, error } = await supabase
    .from('action_items')
    .select('id, title, created_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .is('deleted_at', null)
    .lte('created_at', sevenDaysAgo.toISOString());

  if (error) {
    console.error(`[nudge:action_item_reminder] query failed for ${userId}:`, error);
    return;
  }

  if (!staleActions || staleActions.length === 0) return;

  for (const action of staleActions) {
    const daysPending = action.created_at
      ? Math.ceil(
          (Date.now() - new Date(action.created_at).getTime()) / (24 * 60 * 60 * 1000)
        )
      : 7;

    await createNudge(supabase, {
      userId,
      type: 'action_item_reminder',
      variables: {
        action_title: action.title,
        action_id: action.id,
        days_pending: daysPending,
      },
      scopeKey: `action:${action.id}`,
    });
  }
}
