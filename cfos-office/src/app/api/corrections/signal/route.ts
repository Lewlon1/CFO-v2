import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { getTimeContext } from '@/lib/utils/time-context'

const VALID_VALUES = ['foundation', 'investment', 'leak', 'burden', 'no_idea']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const { transaction_id, value_category } = body

  if (!transaction_id || !value_category || !VALID_VALUES.includes(value_category)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // 1. Fetch transaction (RLS ensures ownership)
  const { data: txn, error: fetchError } = await supabase
    .from('transactions')
    .select('id, description, date, amount, category_id')
    .eq('id', transaction_id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !txn) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  // 2. Compute derived fields
  const merchantClean = normaliseMerchant(txn.description)
  const txnDate = new Date(txn.date)
  const timeContext = getTimeContext(txnDate)
  const dayOfMonth = txnDate.getDate()

  // 3. Update transaction
  const { error: updateError } = await supabase
    .from('transactions')
    .update({
      value_category,
      value_confidence: 1.0,
      value_confirmed_by_user: true,
      prediction_source: 'user_confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', transaction_id)
    .eq('user_id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // 4. Insert correction signal
  await supabase.from('correction_signals').insert({
    user_id: user.id,
    transaction_id,
    merchant_clean: merchantClean,
    category_id: txn.category_id,
    value_category,
    amount: txn.amount,
    transaction_time: txn.date,
    time_context: timeContext,
    day_of_month: dayOfMonth,
    weight_multiplier: 1.0,
  })

  // 5. Upsert merchant rule
  await supabase.from('value_category_rules').upsert(
    {
      user_id: user.id,
      match_type: 'merchant' as const,
      match_value: merchantClean,
      value_category,
      confidence: 1.0,
      source: 'correction',
      last_signal_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,match_type,match_value,coalesce(time_context,\'__none__\')' }
  )

  // 6. Count signals for this merchant
  const { count } = await supabase
    .from('correction_signals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('merchant_clean', merchantClean)

  return NextResponse.json({
    success: true,
    merchant_clean: merchantClean,
    signals_for_merchant: count ?? 1,
  })
}
