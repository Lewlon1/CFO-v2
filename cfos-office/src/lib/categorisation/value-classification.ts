import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from './normalise-merchant'
import { CATEGORY_AMBIGUITY } from './context-signals'
import { getTimeContext } from '@/lib/utils/time-context'
import { VCR_ON_CONFLICT, NONE_TIME_CONTEXT } from '@/lib/prediction/types'
import { rescoreValueCategories } from './value-rescore'

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
  const writtenRuleIds: string[] = []
  const { data: merchantRule } = await supabase
    .from('value_category_rules')
    .upsert(
      {
        user_id: userId,
        match_type: 'merchant' as const,
        match_value: normDesc,
        value_category: newValue,
        confidence: 1.0,
        time_context: NONE_TIME_CONTEXT,
        source: 'correction',
        last_signal_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: VCR_ON_CONFLICT }
    )
    .select('id')
  for (const r of merchantRule ?? []) writtenRuleIds.push(r.id)

  // For high-ambiguity categories at contextual times, also create a merchant_time rule
  if (ambiguity !== 'low') {
    const d = new Date(date)
    const timeContext = getTimeContext(d)
    const isContextual = timeContext === 'weekday_late' ||
      timeContext === 'weekday_evening' ||
      timeContext === 'weekend_evening'

    if (isContextual) {
      const { data: timeRule } = await supabase
        .from('value_category_rules')
        .upsert(
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
          { onConflict: VCR_ON_CONFLICT }
        )
        .select('id')
      for (const r of timeRule ?? []) writtenRuleIds.push(r.id)
    }
  }

  // 4. Propagate to similar unconfirmed transactions — re-score scoped to the
  // rules just written (VM-2). Same matcher + normalisation as ingest;
  // user_confirmed rows untouched. Best-effort: the classification (and the
  // rule write) must never fail because re-score failed.
  let propagatedCount = 0
  if (applyToSimilar && writtenRuleIds.length > 0) {
    try {
      const rescore = await rescoreValueCategories(userId, {
        ruleIds: writtenRuleIds,
        supabase,
      })
      propagatedCount = rescore.updated
    } catch (err) {
      console.error('[value-classification] scoped rescore failed:', err)
    }
  }

  return { ok: true, propagatedCount }
}
