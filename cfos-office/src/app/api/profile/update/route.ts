import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { calculateProfileCompleteness } from '@/lib/profiling/engine';

const ALLOWED_FIELDS = new Set([
  'display_name', 'country', 'city', 'primary_currency', 'age_range',
  'employment_status', 'gross_salary', 'net_monthly_income', 'pay_frequency',
  'has_bonus_months', 'bonus_month_details', 'housing_type', 'monthly_rent',
  'relationship_status', 'partner_employment_status', 'partner_monthly_contribution',
  'dependents', 'values_ranking', 'spending_triggers', 'risk_tolerance',
  'financial_awareness', 'advice_style', 'nationality', 'residency_status',
  'tax_residency_country', 'years_in_country',
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { field, value } = await req.json();

  if (!field || !ALLOWED_FIELDS.has(field)) {
    return Response.json({ error: 'Invalid field' }, { status: 400 });
  }

  // Update the field
  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({
      [field]: value,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (updateError) {
    console.error('Profile update error:', updateError);
    return Response.json({ error: 'Failed to update' }, { status: 500 });
  }

  // Track in profiling queue as user-confirmed
  await supabase.from('profiling_queue').upsert(
    {
      user_id: user.id,
      field,
      status: 'answered',
      answered_at: new Date().toISOString(),
      source: 'structured_input',
    },
    { onConflict: 'user_id,field' }
  );

  // Recalculate profile completeness
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profile) {
    const completeness = calculateProfileCompleteness(profile);
    await supabase
      .from('user_profiles')
      .update({ profile_completeness: completeness })
      .eq('id', user.id);

    revalidatePath('/', 'layout');
  }

  return Response.json({ success: true });
}
