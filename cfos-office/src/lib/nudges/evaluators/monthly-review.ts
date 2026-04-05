import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluateMonthlyReview(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const now = new Date();
  if (now.getDate() < 7) return;

  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const monthLabel = prevMonth.toLocaleDateString('en-GB', { month: 'long' });

  const { data: snapshot } = await supabase
    .from('monthly_snapshots')
    .select('id, reviewed_at')
    .eq('user_id', userId)
    .eq('month', prevMonth.toISOString().split('T')[0])
    .single();

  if (!snapshot) {
    const { count } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('date', prevMonth.toISOString().split('T')[0])
      .lte('date', prevMonthEnd.toISOString().split('T')[0]);

    if (!count || count < 5) return;
  }

  if (snapshot?.reviewed_at) return;

  const { data: activeReview } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'monthly_review')
    .eq('status', 'active')
    .limit(1);

  if (activeReview && activeReview.length > 0) return;

  await createNudge(supabase, {
    userId,
    type: 'monthly_review',
    variables: { month: monthLabel },
  });
}
