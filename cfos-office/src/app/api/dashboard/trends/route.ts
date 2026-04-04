import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export type TrendMonth = {
  month: string
  total_spending: number
  total_income: number
  surplus_deficit: number
  spending_by_value_category: Record<string, number>
}

export type TrendsResponse = {
  months: TrendMonth[]
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const limit = parseInt(req.nextUrl.searchParams.get('months') ?? '6', 10)

  const { data: snapshots } = await supabase
    .from('monthly_snapshots')
    .select('month, total_spending, total_income, surplus_deficit, spending_by_value_category')
    .eq('user_id', user.id)
    .order('month', { ascending: true })
    .limit(limit)

  const months: TrendMonth[] = (snapshots ?? []).map(s => ({
    month: s.month,
    total_spending: s.total_spending ?? 0,
    total_income: s.total_income ?? 0,
    surplus_deficit: s.surplus_deficit ?? 0,
    spending_by_value_category: (s.spending_by_value_category ?? {}) as Record<string, number>,
  }))

  return NextResponse.json({ months })
}
