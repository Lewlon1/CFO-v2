import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluateBillDue(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: bills } = await supabase
    .from('recurring_expenses')
    .select('id, name, amount, currency, billing_day, frequency')
    .eq('user_id', userId)
    .not('billing_day', 'is', null);

  if (!bills || bills.length === 0) return;

  const now = new Date();
  const currentDay = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  for (const bill of bills) {
    let daysUntil = bill.billing_day - currentDay;
    if (daysUntil < 0) daysUntil += daysInMonth;

    if (daysUntil >= 3 && daysUntil <= 5) {
      const dueDate = new Date(now.getFullYear(), now.getMonth(), bill.billing_day);
      if (bill.billing_day <= currentDay) {
        dueDate.setMonth(dueDate.getMonth() + 1);
      }

      await createNudge(supabase, {
        userId,
        type: 'bill_due',
        variables: {
          bill_name: bill.name,
          amount: bill.amount.toFixed(2),
          currency: bill.currency ?? 'EUR',
          days: daysUntil,
          due_date: dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        },
        scopeKey: `bill:${bill.id}`,
      });
    }
  }
}
