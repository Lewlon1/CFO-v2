import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { bill_id } = await req.json()
  if (!bill_id) {
    return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('recurring_expenses')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', bill_id)
    .eq('user_id', user.id)
    .neq('status', 'tracked') // don't dismiss tracked bills — allow null or 'detected'

  if (error) {
    console.error('[bill-dismiss] Update error:', error)
    return NextResponse.json({ error: 'Failed to dismiss bill' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
