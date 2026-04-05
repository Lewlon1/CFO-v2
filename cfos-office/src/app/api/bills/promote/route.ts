import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { matchProvider } from '@/lib/bills/provider-registry'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { bill_id } = await req.json()
  if (!bill_id) {
    return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
  }

  // Fetch the current bill
  const { data: bill, error: fetchError } = await supabase
    .from('recurring_expenses')
    .select('*')
    .eq('id', bill_id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }

  if (bill.status === 'tracked') {
    return NextResponse.json({ bill }) // already tracked
  }

  // Enrich with provider registry data if possible
  const providerMatch = matchProvider(bill.name, bill.provider)

  const updateData: Record<string, unknown> = {
    status: 'tracked',
    updated_at: new Date().toISOString(),
  }

  if (providerMatch && !bill.provider) {
    updateData.provider = providerMatch.provider.name
  }
  if (providerMatch && !bill.category_id) {
    updateData.category_id = providerMatch.provider.type
  }

  const { data: updated, error: updateError } = await supabase
    .from('recurring_expenses')
    .update(updateData)
    .eq('id', bill_id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (updateError) {
    console.error('[bill-promote] Update error:', updateError)
    return NextResponse.json({ error: 'Failed to promote bill' }, { status: 500 })
  }

  return NextResponse.json({ bill: updated })
}
