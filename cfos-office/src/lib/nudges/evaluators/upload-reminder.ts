import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluateUploadReminder(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const thirtyFiveDaysAgo = new Date();
  thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);

  const { data: latest } = await supabase
    .from('transactions')
    .select('date')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (!latest) return;

  const latestDate = new Date(latest.date);
  if (latestDate > thirtyFiveDaysAgo) return;

  const daysSinceUpload = Math.ceil(
    (Date.now() - latestDate.getTime()) / (24 * 60 * 60 * 1000)
  );

  const currentMonth = new Date().toLocaleDateString('en-GB', { month: 'long' });

  await createNudge(supabase, {
    userId,
    type: 'upload_reminder',
    variables: {
      month: currentMonth,
      days: daysSinceUpload,
    },
  });
}
