import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/profile/income-shape
 *
 * Returns derived income-shape and posture fields from user_profiles for
 * the authenticated user. Used by the dev-only IncomeShapeBadge on the
 * Cash Flow folder. Returns nulls when detection has not yet run.
 *
 * URL path is kept stable for the SWR fetcher hook key; the route's
 * responsibility is now broader than its name suggests.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('user_profiles')
    .select(
      'income_shape, income_volatility, income_shape_deposit_count, income_shape_detected_at, financial_posture, posture_confidence, runway_days, t3m_income_monthly, t3m_spend_monthly, balance_trajectory, posture_detected_at',
    )
    .eq('id', user.id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
