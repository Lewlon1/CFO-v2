import { SupabaseClient } from '@supabase/supabase-js';
import { createNudge } from '../create';

export async function evaluateContractExpiry(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const twentyFiveDays = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000);

  const { data: expiring } = await supabase
    .from('recurring_expenses')
    .select('id, name, provider, contract_end_date')
    .eq('user_id', userId)
    .not('contract_end_date', 'is', null)
    .gte('contract_end_date', twentyFiveDays.toISOString().split('T')[0])
    .lte('contract_end_date', thirtyDays.toISOString().split('T')[0]);

  if (!expiring) return;

  for (const bill of expiring) {
    const expiryDate = new Date(bill.contract_end_date);
    const daysUntil = Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    await createNudge(supabase, {
      userId,
      type: 'contract_expiry',
      variables: {
        provider: bill.provider ?? bill.name,
        provider_slug: bill.id,
        days: daysUntil,
        expiry_date: expiryDate.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      },
      scopeKey: `contract:${bill.id}`,
    });
  }
}
