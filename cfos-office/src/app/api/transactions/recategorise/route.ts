import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

// POST /api/transactions/recategorise
// Body: { transactionId, field, newValue, applyToSimilar?, description? }
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const { transactionId, field, newValue, applyToSimilar, description } = body

  if (!transactionId || !field || !newValue) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (field !== 'category_id' && field !== 'value_category') {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  }

  const { error } = await supabase
    .from('transactions')
    .update({ [field]: newValue, user_confirmed: true })
    .eq('id', transactionId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (applyToSimilar && description && field === 'value_category') {
    const normDesc = normaliseMerchant(description)
    await supabase.from('value_category_rules').upsert(
      {
        user_id: user.id,
        match_type: 'merchant_contains',
        match_value: normDesc,
        value_category: newValue,
        confidence: 1.0,
        source: 'user_explicit',
      },
      { onConflict: 'user_id,match_type,match_value' }
    )
  }

  return NextResponse.json({ ok: true })
}
