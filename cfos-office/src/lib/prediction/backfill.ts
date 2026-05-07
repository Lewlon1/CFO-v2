import { createServiceClient } from '@/lib/supabase/service'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { loadUserRules, resolveValueCategory } from './predictor'
import type { Category } from '@/lib/parsers/types'

/**
 * Re-score transactions for a merchant after rules change.
 * Only updates transactions that weren't user-confirmed.
 * Called async after processSignals completes.
 */
export async function backfillForMerchant(
  userId: string,
  merchantClean: string
): Promise<{ updated: number }> {
  const supabase = createServiceClient()

  // Load current rules and categories
  const [rules, { data: catData }] = await Promise.all([
    loadUserRules(supabase, userId),
    supabase.from('categories').select('id, name, tier, icon, color, examples, default_value_category').eq('is_active', true),
  ])
  const categories = (catData ?? []) as Category[]

  // Find transactions for this merchant that are unconfirmed
  const { data: txns, error } = await supabase
    .from('transactions')
    .select('id, description, category_id, amount, date, value_category, value_confidence, prediction_source')
    .eq('user_id', userId)
    .neq('prediction_source', 'user_confirmed')
    .is('confirmed_at', null)

  if (error || !txns) return { updated: 0 }

  // Filter to matching merchant (normalise in JS since SQL can't call our function)
  const matching = txns.filter((t) => normaliseMerchant(t.description) === merchantClean)

  let updated = 0
  for (const txn of matching) {
    const prediction = resolveValueCategory(
      rules,
      categories,
      merchantClean,
      txn.category_id,
      txn.amount,
      new Date(txn.date)
    )

    // Only update if prediction differs or has higher confidence
    if (
      prediction.value_category !== txn.value_category ||
      prediction.confidence > txn.value_confidence
    ) {
      const { error: updateErr } = await supabase
        .from('transactions')
        .update({
          value_category: prediction.value_category ?? 'no_idea',
          value_confidence: prediction.confidence,
          prediction_source: prediction.source === 'none' ? 'category_default' : prediction.source.includes('merchant') ? 'merchant_rule' : prediction.source,
        })
        .eq('id', txn.id)
        .eq('user_id', userId)

      if (!updateErr) updated++
    }
  }

  return { updated }
}
