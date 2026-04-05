import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluateSpendingSpikes(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', userId)
    .single();

  if (!categories) return;
  const currency = profile?.primary_currency ?? 'EUR';

  const { data: weekSpending } = await supabase
    .from('transactions')
    .select('category_id, amount')
    .eq('user_id', userId)
    .lt('amount', 0)
    .gte('date', weekStart.toISOString().split('T')[0]);

  const { data: historicalSpending } = await supabase
    .from('transactions')
    .select('category_id, amount')
    .eq('user_id', userId)
    .lt('amount', 0)
    .gte('date', threeMonthsAgo.toISOString().split('T')[0])
    .lt('date', weekStart.toISOString().split('T')[0]);

  if (!weekSpending || !historicalSpending) return;

  const weekByCategory: Record<string, number> = {};
  for (const txn of weekSpending) {
    if (txn.category_id) {
      weekByCategory[txn.category_id] = (weekByCategory[txn.category_id] ?? 0) + Math.abs(txn.amount);
    }
  }

  const histByCategory: Record<string, number> = {};
  for (const txn of historicalSpending) {
    if (txn.category_id) {
      histByCategory[txn.category_id] = (histByCategory[txn.category_id] ?? 0) + Math.abs(txn.amount);
    }
  }

  const historicalWeeks = Math.max(
    1,
    Math.round((weekStart.getTime() - threeMonthsAgo.getTime()) / (7 * 24 * 60 * 60 * 1000))
  );

  const categoryMap = new Map(categories.map(c => [c.id, c.name]));

  for (const [catId, weekAmount] of Object.entries(weekByCategory)) {
    const weeklyAvg = (histByCategory[catId] ?? 0) / historicalWeeks;
    if (weeklyAvg < 10) continue;

    const multiplier = weekAmount / weeklyAvg;

    if (multiplier >= 2) {
      await createNudge(supabase, {
        userId,
        type: 'spending_spike',
        variables: {
          category: categoryMap.get(catId) ?? 'Unknown',
          category_slug: catId,
          amount: weekAmount.toFixed(2),
          currency,
          multiplier: multiplier.toFixed(1),
        },
        scopeKey: `spike:${catId}`,
      });
    }
  }
}
