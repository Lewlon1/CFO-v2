import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const search = req.nextUrl.searchParams.get('search')
  if (!search) {
    return NextResponse.json({ transactions: [] })
  }

  const { data } = await supabase
    .from('transactions')
    .select('date, amount, description')
    .eq('user_id', user.id)
    .ilike('description', `%${search}%`)
    .order('date', { ascending: false })
    .limit(12)

  return NextResponse.json({ transactions: data || [] })
}
