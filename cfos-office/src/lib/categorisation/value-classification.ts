import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from './normalise-merchant'
import { CATEGORY_AMBIGUITY } from './context-signals'
import type { ContextConditions } from '@/lib/parsers/types'

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
    contextNote,
  } = params

  // 1. Update the transaction
  const { error } = await supabase
    .from('transactions')
    .update({
      value_category: newValue,
      value_confidence: 1.0,
      value_confirmed_by_user: true,
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
      ...(contextNote ? { context_note: contextNote } : {}),
    },
  })

  // 3. Build contextual rule
  const contextConditions = deriveContextConditions(date, amount, categoryId)
  const normDesc = normaliseMerchant(description)

  if (contextConditions) {
    await supabase.from('value_category_rules').insert({
      user_id: userId,
      match_type: 'merchant_contains',
      match_value: normDesc,
      value_category: newValue,
      confidence: 0.85,
      source: 'user_classification',
      context_conditions: contextConditions,
    })
  } else {
    await supabase.from('value_category_rules').upsert(
      {
        user_id: userId,
        match_type: 'merchant_contains',
        match_value: normDesc,
        value_category: newValue,
        confidence: 1.0,
        source: 'user_explicit',
        context_conditions: null,
      },
      { onConflict: 'user_id,match_type,match_value' }
    )
  }

  // 4. Propagate to similar unconfirmed transactions
  let propagatedCount = 0
  if (applyToSimilar) {
    const { data: propagated } = await supabase
      .from('transactions')
      .update({ value_category: newValue, value_confidence: 0.8 })
      .eq('user_id', userId)
      .eq('value_confirmed_by_user', false)
      .neq('id', transactionId)
      .ilike('description', `%${normDesc}%`)
      .select('id')

    propagatedCount = propagated?.length ?? 0
  }

  return { ok: true, propagatedCount }
}

// ── Contextual rule derivation ────────────────────────────────────────

export function deriveContextConditions(
  dateStr: string,
  amount: number,
  categoryId: string | null
): ContextConditions {
  const ambiguity = categoryId ? (CATEGORY_AMBIGUITY[categoryId] ?? 'high') : 'high'
  if (ambiguity === 'low') return null

  const d = new Date(dateStr)
  const hour = d.getHours()
  const dayOfWeek = d.getDay()
  const isFridayEvening = dayOfWeek === 5 && hour >= 17
  const isLateNight = hour >= 22 || hour < 5
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

  if (!isLateNight && !isFridayEvening && !isWeekend) return null

  const conditions: NonNullable<ContextConditions> = {}

  if (isLateNight || isFridayEvening) {
    conditions.hour_range = {
      from: (hour - 2 + 24) % 24,
      to: (hour + 2) % 24,
    }
  }

  if (isFridayEvening) {
    conditions.day_type = 'friday_evening'
  } else if (isWeekend) {
    conditions.day_type = 'weekend'
  }

  return Object.keys(conditions).length > 0 ? conditions : null
}
