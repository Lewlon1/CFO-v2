import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { applyValueClassification } from '@/lib/categorisation/value-classification'

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

  // Fetch old value and transaction details (needed for contextual rule creation)
  const { data: existing } = await supabase
    .from('transactions')
    .select('category_id, value_category, date, amount, description')
    .eq('id', transactionId)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  // ── Value category update ──────────────────────────────────────────
  if (field === 'value_category') {
    const result = await applyValueClassification(supabase, user.id, {
      transactionId,
      newValue,
      applyToSimilar: !!applyToSimilar,
      description: description ?? existing.description,
      date: existing.date,
      amount: existing.amount,
      categoryId: existing.category_id,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ ok: true, propagated: result.propagatedCount })
  }

  // ── Traditional category update (unchanged logic) ──────────────────
  const { error } = await supabase
    .from('transactions')
    .update({ [field]: newValue, user_confirmed: true })
    .eq('id', transactionId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log correction event
  void supabase.from('user_events').insert({
    profile_id: user.id,
    event_type: 'category_corrected',
    event_category: 'correction',
    payload: {
      transaction_id: transactionId,
      field,
      old_value: existing.category_id ?? null,
      new_value: newValue,
      description: description ?? existing.description,
    },
  })

  if (applyToSimilar && description) {
    const normDesc = normaliseMerchant(description)
    await supabase.from('user_merchant_rules').upsert(
      {
        user_id: user.id,
        normalised_merchant: normDesc,
        category_id: newValue,
        confidence: 0.95,
        source: 'user_correction',
      },
      { onConflict: 'user_id,normalised_merchant' }
    )
  }

  return NextResponse.json({ ok: true })
}

