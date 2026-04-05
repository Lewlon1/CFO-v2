import { createClient } from '@/lib/supabase/server'

const EXPORTABLE_FIELDS = [
  'display_name',
  'country',
  'city',
  'primary_currency',
  'age_range',
  'employment_status',
  'gross_salary',
  'net_monthly_income',
  'pay_frequency',
  'has_bonus_months',
  'housing_type',
  'monthly_rent',
  'relationship_status',
  'partner_employment_status',
  'partner_monthly_contribution',
  'dependents',
  'nationality',
  'residency_status',
  'tax_residency_country',
  'years_in_country',
] as const

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select(EXPORTABLE_FIELDS.join(','))
    .eq('id', user.id)
    .single()

  if (!profile) return new Response('Profile not found', { status: 404 })

  const { data: goals } = await supabase
    .from('goals')
    .select('name, description, target_amount, target_date, status, created_at')
    .eq('user_id', user.id)

  const { data: actions } = await supabase
    .from('action_items')
    .select('title, description, category, priority, status, due_date, completed_at, created_at')
    .eq('profile_id', user.id)

  // Archetype name only — not the underlying analysis
  const { data: valueMapSession } = await supabase
    .from('value_map_sessions')
    .select('personality_type')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  const exportData = {
    exported_at: new Date().toISOString(),
    profile: Object.fromEntries(
      Object.entries(profile).filter(([, v]) => v !== null)
    ),
    goals: goals ?? [],
    action_items: actions ?? [],
    value_map_archetype: valueMapSession?.[0]?.personality_type ?? null,
  }

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="cfos-office-profile-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
