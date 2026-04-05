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

  // Fetch bill data
  const { data: bill } = await supabase
    .from('recurring_expenses')
    .select('*')
    .eq('id', bill_id)
    .eq('user_id', user.id)
    .single()

  if (!bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }

  // Mark any active conversations as completed
  await supabase
    .from('conversations')
    .update({ status: 'completed' })
    .eq('user_id', user.id)
    .eq('status', 'active')

  // Create a new bill_optimisation conversation
  const planDetails = bill.current_plan_details as Record<string, unknown> | null

  const { data: conversation, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      title: `Bill review: ${bill.provider || bill.name}`,
      type: 'bill_optimisation',
      metadata: {
        bill_id: bill.id,
        provider: bill.provider,
        bill_type: planDetails?.bill_type || null,
        current_amount: bill.amount,
        frequency: bill.frequency,
      },
      status: 'active',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[bill-start-conversation] Error:', error)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }

  return NextResponse.json({ conversation_id: conversation.id })
}
