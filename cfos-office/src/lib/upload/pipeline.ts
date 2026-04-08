import type { SupabaseClient } from '@supabase/supabase-js'
import { categoriseByRules } from '@/lib/categorisation/rules-engine'
import { llmCategorise } from '@/lib/categorisation/llm-categoriser'
import { assignValueCategory } from '@/lib/categorisation/value-categoriser'
import { extractSignals, type MerchantHistory } from '@/lib/categorisation/context-signals'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { computeCategorizationStats, type CategorizationStats } from '@/lib/categorisation/categorisation-stats'
import { loadExistingKeys, isDuplicate } from './duplicate-detector'
import type { ParsedTransaction, Category, ValueCategoryRule, UserMerchantRule, RecurringMatch } from '@/lib/parsers/types'
import type { CatResult } from '@/lib/categorisation/rules-engine'

export type PipelineStats = {
  imported: number
  duplicates: number
  errors: number
  categorisation?: CategorizationStats
}

export type PipelineOptions = {
  userId: string
  importBatchId: string
  skipDuplicates?: boolean // default true
}

type TxnToInsert = ParsedTransaction & {
  categoryId: string | null
  confidence: number
  valueCategory: string
  valueConfidence: number
  needsLLM: boolean
  tier: CatResult['tier']
}

// When importing from the preview, the user may have adjusted categories.
// Pass these overrides so the pipeline skips re-categorisation for those rows.
export type ImportableTransaction = ParsedTransaction & {
  presetCategoryId?: string | null
  presetValueCategory?: string
}

export async function runImportPipeline(
  transactions: ImportableTransaction[],
  supabase: SupabaseClient,
  opts: PipelineOptions
): Promise<PipelineStats> {
  const stats: PipelineStats = { imported: 0, duplicates: 0, errors: 0 }
  if (transactions.length === 0) return stats

  // Load reference data (parallel)
  const [
    { data: catData },
    { data: rulesData },
    { data: merchantRulesData },
    { data: recurringData },
    { data: historyData },
  ] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, tier, icon, color, examples, default_value_category')
      .eq('is_active', true),
    supabase
      .from('value_category_rules')
      .select('match_type, match_value, value_category, confidence, source, context_conditions')
      .eq('user_id', opts.userId),
    supabase
      .from('user_merchant_rules')
      .select('normalised_merchant, category_id, confidence')
      .eq('user_id', opts.userId),
    supabase
      .from('recurring_expenses')
      .select('name, category_id')
      .eq('user_id', opts.userId),
    supabase.rpc('merchant_history', { p_user_id: opts.userId }).then(
      (res) => res,
      // If the RPC doesn't exist yet, fall back to empty
      () => ({ data: null, error: null })
    ),
  ])

  const categories: Category[] = catData ?? []
  const userRules: ValueCategoryRule[] = rulesData ?? []
  const userMerchantRules: UserMerchantRule[] = merchantRulesData ?? []
  const recurringExpenses: RecurringMatch[] = recurringData ?? []

  // Build merchant history map for contextual signal extraction
  const merchantHistory = new Map<string, MerchantHistory>()
  if (historyData && Array.isArray(historyData)) {
    for (const row of historyData) {
      merchantHistory.set(row.merchant, {
        count: Number(row.count),
        median_amount: Number(row.median_amount),
      })
    }
  }

  // Batch transaction summaries for same-week frequency detection
  const batchSummaries = transactions.map((t) => ({
    date: t.date,
    description: t.description,
  }))

  // Load existing keys for duplicate detection
  const dates = transactions.map((t) => t.date).sort()
  const existingKeys = await loadExistingKeys(
    supabase, opts.userId, dates[0], dates[dates.length - 1]
  )

  // Pass 1: rules-based categorisation
  const toInsert: TxnToInsert[] = []

  for (const txn of transactions) {
    if (opts.skipDuplicates !== false && isDuplicate(txn, existingKeys)) {
      stats.duplicates++
      continue
    }

    // Extract contextual signals for this transaction
    const signals = extractSignals(
      { date: txn.date, description: txn.description, amount: txn.amount },
      merchantHistory,
      batchSummaries
    )

    // Use user-preset categories from preview if provided
    if (txn.presetCategoryId !== undefined || txn.presetValueCategory !== undefined) {
      const categoryId = txn.presetCategoryId !== undefined ? txn.presetCategoryId : null
      const valResult = txn.presetValueCategory
        ? { valueCategory: txn.presetValueCategory, confidence: 1.0 }
        : assignValueCategory(txn.description, categoryId, userRules, categories, signals, txn.amount)
      toInsert.push({
        ...txn,
        categoryId,
        confidence: 1.0,
        valueCategory: valResult.valueCategory,
        valueConfidence: valResult.confidence,
        needsLLM: false,
        tier: 'user_rule',
      })
      continue
    }

    const catResult = categoriseByRules(txn.description, {
      categories,
      amount: txn.amount,
      userMerchantRules,
      recurringExpenses,
    })

    // Check if this merchant is a known recurring expense
    const isRecurring = recurringExpenses.some(
      (r) => normaliseMerchant(txn.description) === normaliseMerchant(r.name)
    )

    const valResult = assignValueCategory(
      txn.description,
      catResult.categoryId,
      userRules,
      categories,
      { ...signals, is_recurring: isRecurring },
      txn.amount
    )

    toInsert.push({
      ...txn,
      categoryId: catResult.categoryId,
      confidence: catResult.confidence,
      valueCategory: valResult.valueCategory,
      valueConfidence: valResult.confidence,
      needsLLM: catResult.categoryId === null,
      tier: catResult.tier,
    })
  }

  // Pass 2: batch LLM for unmatched
  const unmatched = toInsert.filter((t) => t.needsLLM)
  if (unmatched.length > 0) {
    const llmResults = await llmCategorise(
      unmatched.map((t) => t.description),
      categories,
      opts.userId
    )
    for (const result of llmResults) {
      const txn = unmatched[result.index - 1]
      if (txn) {
        txn.categoryId = result.category_id
        txn.confidence = result.confidence
        txn.tier = 'keyword' // LLM results tracked separately in stats via needsLLM
        const signals = extractSignals(
          { date: txn.date, description: txn.description, amount: txn.amount },
          merchantHistory,
          batchSummaries
        )
        const valResult = assignValueCategory(
          txn.description, txn.categoryId, userRules, categories, signals, txn.amount
        )
        txn.valueCategory = valResult.valueCategory
        txn.valueConfidence = valResult.confidence
      }
    }
  }

  // Compute categorisation stats
  stats.categorisation = computeCategorizationStats(toInsert)

  // Pass 3: insert
  for (const txn of toInsert) {
    const { error } = await supabase.from('transactions').insert({
      user_id: opts.userId,
      date: txn.date,
      description: txn.description,
      raw_description: txn.raw_description,
      amount: txn.amount,
      currency: txn.currency,
      category_id: txn.categoryId || null,
      auto_category_confidence: txn.confidence,
      value_category: txn.valueCategory,
      value_confidence: txn.valueConfidence,
      value_confirmed_by_user: false,
      source: txn.source,
      import_batch_id: opts.importBatchId,
      user_confirmed: false,
    })
    if (error) {
      console.error('[pipeline] insert error:', error.message, error.details, error.code)
      stats.errors++
    } else {
      stats.imported++
    }
  }

  return stats
}
