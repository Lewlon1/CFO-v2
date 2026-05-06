import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from './normalise-merchant'
import { CATEGORY_AMBIGUITY } from './context-signals'
import { getTimeContext } from '@/lib/utils/time-context'

// ── Types ─────────────────────────────────────────────────────────────

export type ClassificationParams = {
  transactionId: string
  newValue: string
  applyToSimilar: boolean
  description: string
  date: string
  amount: number
  categoryId: string | null
  contextNote?: string
}

type ClassificationResult =
  | { ok: true; propagatedCount: number }
  | { ok: false; error: string }

// ── Apply a single value classification ───────────────────────────────

export async function applyValueClassification(
  supabase: SupabaseClient,
  userId: string,
  params: ClassificationParams
): Promise<ClassificationResult> {
  const {
    transactionId,
    newValue,
    applyToSimilar,
    description,
    date,
    amount,
    categoryId,
  } = params

  // 1. Update the transaction
  const { error } = await supabase
    .from('transactions')
    .update({
      value_category: newValue,
      value_confidence: 1.0,
      value_confirmed_by_user: true,
      prediction_source: 'user_confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', transactionId)
    .eq('user_id', userId)

  if (error) return { ok: false, error: error.message }

  // 2. Log correction event
  void supabase.from('user_events').insert({
    profile_id: userId,
    event_type: 'value_category_corrected',
    event_category: 'correction',
    payload: {
      transaction_id: transactionId,
      field: 'value_category',
      new_value: newValue,
      description,
    },
  })

  // 3. Upsert value_category_rules (new schema: match_type = 'merchant')
  const normDesc = normaliseMerchant(description)
  const ambiguity = categoryId ? (CATEGORY_AMBIGUITY[categoryId] ?? 'high') : 'high'

  // Always create/update a plain merchant rule
  await supabase.from('value_category_rules').upsert(
    {
      user_id: userId,
      match_type: 'merchant' as const,
      match_value: normDesc,
      value_category: newValue,
      confidence: 1.0,
      source: 'correction',
      last_signal_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,match_type,match_value,coalesce(time_context,\'__none__\')' }
  )

  // For high-ambiguity categories at contextual times, also create a merchant_time rule
  if (ambiguity !== 'low') {
    const d = new Date(date)
    const timeContext = getTimeContext(d)
    const isContextual = timeContext === 'weekday_late' ||
      timeContext === 'weekday_evening' ||
      timeContext === 'weekend_evening'

    if (isContextual) {
      await supabase.from('value_category_rules').upsert(
        {
          user_id: userId,
          match_type: 'merchant_time' as const,
          match_value: normDesc,
          value_category: newValue,
          confidence: 0.85,
          time_context: timeContext,
          source: 'correction',
          last_signal_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,match_type,match_value,coalesce(time_context,\'__none__\')' }
      )
    }
  }

  // 4. Propagate to similar unconfirmed transactions
  let propagatedCount = 0
  if (applyToSimilar) {
    const { data: propagated } = await supabase
      .from('transactions')
      .update({
        value_category: newValue,
        value_confidence: 0.8,
        prediction_source: 'merchant_rule',
      })
      .eq('user_id', userId)
      .eq('value_confirmed_by_user', false)
      .neq('id', transactionId)
      .ilike('description', `%${normDesc}%`)
      .select('id')

    propagatedCount = propagated?.length ?? 0
  }

  return { ok: true, propagatedCount }
}
