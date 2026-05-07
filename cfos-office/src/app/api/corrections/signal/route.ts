import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { getTimeContext } from '@/lib/utils/time-context'
import { processSignals } from '@/lib/prediction/process-signals'
import { backfillForMerchant } from '@/lib/prediction/backfill'

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

  // 5. Trigger async learning — runs after response is sent
  after(async () => {
    try {
      await processSignals(user.id, merchantClean)
      await backfillForMerchant(user.id, merchantClean)
    } catch (err) {
      console.error('[learning-engine] processSignals failed:', err)
    }
  })

  return NextResponse.json({
    success: true,
    merchant_clean: merchantClean,
  })
}
