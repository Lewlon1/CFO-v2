import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluateActionItemReminders(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: staleActions } = await supabase
    .from('action_items')
    .select('id, title, created_at, last_nudge_at, nudge_count')
    .eq('profile_id', userId)
    .eq('status', 'pending')
    .lte('created_at', sevenDaysAgo.toISOString())
    .or(`last_nudge_at.is.null,last_nudge_at.lte.${sevenDaysAgo.toISOString()}`);

  if (!staleActions) return;

  for (const action of staleActions) {
    const backoffDays = Math.min(7 * (1 + (action.nudge_count ?? 0)), 28);
    const backoffCutoff = new Date();
    backoffCutoff.setDate(backoffCutoff.getDate() - backoffDays);

    if (action.last_nudge_at && new Date(action.last_nudge_at) > backoffCutoff) {
      continue;
    }

    const daysPending = Math.ceil(
      (Date.now() - new Date(action.created_at).getTime()) / (24 * 60 * 60 * 1000)
    );

    const result = await createNudge(supabase, {
      userId,
      type: 'action_item_reminder',
      variables: {
        action_title: action.title,
        action_id: action.id,
        days_pending: daysPending,
      },
      scopeKey: `action:${action.id}`,
    });

    if (result.created) {
      await supabase
        .from('action_items')
        .update({
          last_nudge_at: new Date().toISOString(),
          nudge_count: (action.nudge_count ?? 0) + 1,
        })
        .eq('id', action.id);
    }
  }
}
