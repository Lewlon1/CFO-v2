import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluateBudgetAlerts(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency, budget_config')
    .eq('id', userId)
    .single();

  const budgetConfig = profile?.budget_config as Record<string, number> | null;
  if (!budgetConfig || Object.keys(budgetConfig).length === 0) return;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = daysInMonth - now.getDate();

  if (daysRemaining < 3) return;

  const currency = profile?.primary_currency ?? 'EUR';

  // Get category names for budgeted categories
  const categoryIds = Object.keys(budgetConfig);
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .in('id', categoryIds);

  const categoryMap = new Map(categories?.map(c => [c.id, c.name]) ?? []);

  // Get spending this month
  const { data: spending } = await supabase
    .from('transactions')
    .select('category_id, amount')
    .eq('user_id', userId)
    .lt('amount', 0)
    .gte('date', monthStart.toISOString().split('T')[0]);

  if (!spending) return;

  const spendByCategory: Record<string, number> = {};
  for (const txn of spending) {
    if (txn.category_id) {
      spendByCategory[txn.category_id] = (spendByCategory[txn.category_id] ?? 0) + Math.abs(txn.amount);
    }
  }

  for (const [catId, budget] of Object.entries(budgetConfig)) {
    if (budget <= 0) continue;
    const spent = spendByCategory[catId] ?? 0;
    const percentage = Math.round((spent / budget) * 100);

    if ((percentage >= 80 && percentage < 100 && daysRemaining >= 10) || percentage >= 100) {
      await createNudge(supabase, {
        userId,
        type: 'budget_alert',
        variables: {
          category: categoryMap.get(catId) ?? catId,
          category_slug: catId,
          percentage,
          spent: spent.toFixed(2),
          budget: budget.toFixed(2),
          currency,
          days_remaining: daysRemaining,
        },
        scopeKey: `category:${catId}`,
      });
    }
  }
}
