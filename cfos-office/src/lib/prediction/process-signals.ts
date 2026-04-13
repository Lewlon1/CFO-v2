import { createServiceClient } from '@/lib/supabase/service'
import { computeFlatRule, computeTimeRules, computeAmountRules, computePriorRule } from './learning-engine'
import type { CorrectionSignal, RuleCandidate } from './types'
import { VCR_ON_CONFLICT } from './types'

/**
 * Process all correction signals for a merchant and recalculate rules.
 * Runs async after a correction signal is stored — the user never waits for this.
 *
 * Steps:
 * 1. Query signals for user + merchant
 * 2. Compute flat merchant rule
 * 3. Check time sensitivity → merchant_time rules
 * 4. Check amount sensitivity → merchant_amount rules (may delete flat rule)
 * 5. Upsert all computed rules
 * 6. Update category-level prior
 * 7. Update global prior
 */
export async function processSignals(userId: string, merchantClean: string): Promise<void> {
  const supabase = createServiceClient()

  // Step 1: Query all signals for this user + merchant
  const { data: signalRows, error: sigErr } = await supabase
    .from('correction_signals')
    .select('value_category, amount, time_context, weight_multiplier, created_at, category_id')
    .eq('user_id', userId)
    .eq('merchant_clean', merchantClean)
    .order('created_at', { ascending: false })

  if (sigErr || !signalRows || signalRows.length === 0) return

  const signals: CorrectionSignal[] = signalRows as CorrectionSignal[]

  // Steps 2-4: Compute rules
  const flatRule = computeFlatRule(merchantClean, signals)
  const timeRules = computeTimeRules(merchantClean, signals, flatRule)
  const amountResult = computeAmountRules(merchantClean, signals)

  // Collect all rules to upsert
  const rulesToUpsert: RuleCandidate[] = [...timeRules, ...amountResult.rules]

  if (amountResult.deleteFlatRule) {
    // Amount explains the variance — delete flat rule if it exists
    await supabase
      .from('value_category_rules')
      .delete()
      .eq('user_id', userId)
      .eq('match_type', 'merchant')
      .eq('match_value', merchantClean)
      .is('time_context', null)
  } else if (flatRule) {
    rulesToUpsert.push(flatRule)
  }

  // Step 5: Upsert computed rules
  for (const rule of rulesToUpsert) {
    await supabase.from('value_category_rules').upsert(
      {
        user_id: userId,
        match_type: rule.match_type,
        match_value: rule.match_value,
        value_category: rule.value_category,
        confidence: rule.confidence,
        total_signals: rule.total_signals,
        agreement_ratio: rule.agreement_ratio,
        avg_amount_low: rule.avg_amount_low,
        avg_amount_high: rule.avg_amount_high,
        time_context: rule.time_context,
        source: rule.source,
        last_signal_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: VCR_ON_CONFLICT }
    )
  }

  // Step 6: Update category-level prior
  const categoryId = signals[0].category_id
  if (categoryId) {
    const { data: catSignals } = await supabase
      .from('correction_signals')
      .select('value_category, amount, time_context, weight_multiplier, created_at, category_id')
      .eq('user_id', userId)
      .eq('category_id', categoryId)

    if (catSignals && catSignals.length > 0) {
      const catPrior = computePriorRule('category', categoryId, catSignals as CorrectionSignal[])
      if (catPrior) {
        await supabase.from('value_category_rules').upsert(
          {
            user_id: userId,
            match_type: catPrior.match_type,
            match_value: catPrior.match_value,
            value_category: catPrior.value_category,
            confidence: catPrior.confidence,
            total_signals: catPrior.total_signals,
            agreement_ratio: catPrior.agreement_ratio,
            avg_amount_low: null,
            avg_amount_high: null,
            time_context: null,
            source: 'learned',
            last_signal_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: VCR_ON_CONFLICT }
        )
      }
    }
  }

  // Step 7: Update global prior
  const { data: allSignals } = await supabase
    .from('correction_signals')
    .select('value_category, amount, time_context, weight_multiplier, created_at, category_id')
    .eq('user_id', userId)

  if (allSignals && allSignals.length > 0) {
    const globalPrior = computePriorRule('global', '__global__', allSignals as CorrectionSignal[])
    if (globalPrior) {
      await supabase.from('value_category_rules').upsert(
        {
          user_id: userId,
          match_type: globalPrior.match_type,
          match_value: globalPrior.match_value,
          value_category: globalPrior.value_category,
          confidence: globalPrior.confidence,
          total_signals: globalPrior.total_signals,
          agreement_ratio: globalPrior.agreement_ratio,
          avg_amount_low: null,
          avg_amount_high: null,
          time_context: null,
          source: 'learned',
          last_signal_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: VCR_ON_CONFLICT }
      )
    }
  }
}
