import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluatePaydaySavings(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('net_monthly_income, primary_currency, savings_rate_target')
    .eq('id', userId)
    .single();

  if (!profile?.net_monthly_income) return;

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const lowerBound = profile.net_monthly_income * 0.8;
  const upperBound = profile.net_monthly_income * 1.2;

  const { data: recentCredits } = await supabase
    .from('transactions')
    .select('amount, description, date')
    .eq('user_id', userId)
    .gt('amount', 0)
    .gte('date', threeDaysAgo.toISOString().split('T')[0])
    .gte('amount', lowerBound)
    .lte('amount', upperBound)
    .order('date', { ascending: false })
    .limit(1);

  if (!recentCredits || recentCredits.length === 0) return;

  const salary = recentCredits[0];
  const savingsRate = profile.savings_rate_target ?? 0.1;
  const savingsSuggestion = Math.round(salary.amount * savingsRate);

  await createNudge(supabase, {
    userId,
    type: 'payday_savings',
    variables: {
      amount: salary.amount.toFixed(2),
      currency: profile.primary_currency ?? 'EUR',
      savings_suggestion: savingsSuggestion.toFixed(2),
    },
  });
}
