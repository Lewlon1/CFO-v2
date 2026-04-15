import type { SupabaseClient } from '@supabase/supabase-js'
import { categoriseByRules } from '@/lib/categorisation/rules-engine'
import { llmCategorise, saveLearnedMerchantRules } from '@/lib/categorisation/llm-categoriser'
import { assignValueCategory } from '@/lib/categorisation/value-categoriser'
import { extractSignals, CATEGORY_AMBIGUITY, type MerchantHistory } from '@/lib/categorisation/context-signals'
import { resolveValueCategory, loadUserRules } from '@/lib/prediction/predictor'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { computeCategorizationStats, type CategorizationStats } from '@/lib/categorisation/categorisation-stats'
import { loadExistingKeys, isDuplicate, computeDedupeHash } from './duplicate-detector'
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
  valuePredictionSource: string
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
    loadUserRules(supabase, opts.userId).then(data => ({ data, error: null })),
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
        ? { valueCategory: txn.presetValueCategory, confidence: 1.0, source: 'user_confirmed' as const }
        : assignValueCategory(txn.description, categoryId, userRules, categories, signals, txn.amount)
      toInsert.push({
        ...txn,
        categoryId,
        confidence: 1.0,
        valueCategory: valResult.valueCategory,
        valueConfidence: valResult.confidence,
        valuePredictionSource: mapSource(valResult.source),
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
    // Recurring essentials bypass the predictor — high confidence from structure
    if (isRecurring && catResult.categoryId) {
      const cat = categories.find(c => c.id === catResult.categoryId)
      if (cat?.default_value_category && (CATEGORY_AMBIGUITY[catResult.categoryId] ?? 'high') === 'low') {
        toInsert.push({
          ...txn,
          categoryId: catResult.categoryId,
          confidence: catResult.confidence,
          valueCategory: cat.default_value_category,
          valueConfidence: 0.9,
          valuePredictionSource: 'recurring_essential',
          needsLLM: false,
          tier: catResult.tier,
        })
        continue
      }
    }

    const valResult = resolveValueCategory(
      userRules,
      categories,
      normaliseMerchant(txn.description),
      catResult.categoryId,
      txn.amount,
      new Date(txn.date)
    )

    toInsert.push({
      ...txn,
      categoryId: catResult.categoryId,
      confidence: catResult.confidence,
      valueCategory: valResult.value_category ?? 'no_idea',
      valueConfidence: valResult.confidence,
      valuePredictionSource: mapSource(valResult.source),
      needsLLM: catResult.categoryId === null,
      tier: catResult.tier,
    })
  }

  // Pass 2: batch LLM for unmatched
  const unmatched = toInsert.filter((t) => t.needsLLM)
  if (unmatched.length > 0) {
    const unmatchedDescriptions = unmatched.map((t) => t.description)
    const llmResults = await llmCategorise(
      unmatchedDescriptions,
      categories,
      opts.userId
    )
    await saveLearnedMerchantRules(
      supabase,
      opts.userId,
      unmatchedDescriptions,
      llmResults
    )
    for (const result of llmResults) {
      const txn = unmatched[result.index - 1]
      if (txn) {
        txn.categoryId = result.category_id
        txn.confidence = result.confidence
        txn.tier = 'keyword' // LLM results tracked separately in stats via needsLLM
        const valResult = resolveValueCategory(
          userRules,
          categories,
          normaliseMerchant(txn.description),
          txn.categoryId,
          txn.amount,
          new Date(txn.date)
        )
        txn.valueCategory = valResult.value_category ?? 'no_idea'
        txn.valueConfidence = valResult.confidence
        txn.valuePredictionSource = mapSource(valResult.source)
      }
    }
  }

  // Compute categorisation stats
  stats.categorisation = computeCategorizationStats(toInsert)

  // Pass 3: insert. The DB unique index on (user_id, dedupe_hash) is partial
  // (WHERE deleted_at IS NULL AND dedupe_hash IS NOT NULL), which Supabase's
  // upsert/onConflict can't target — so we INSERT and treat Postgres error
  // code 23505 (unique_violation) as a duplicate signal. The in-memory pre-check
  // above is a perf optimisation; this is the dedupe source of truth.
  for (const txn of toInsert) {
    const dedupeHash = computeDedupeHash(txn.date, txn.amount, txn.description)
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
      prediction_source: txn.valuePredictionSource,
      source: txn.source,
      import_batch_id: opts.importBatchId,
      user_confirmed: false,
      balance: txn.balance ?? null,
      dedupe_hash: dedupeHash,
    })
    if (error) {
      if (error.code === '23505') {
        stats.duplicates++
      } else {
        console.error('[pipeline] insert error:', error.message, error.details, error.code)
        stats.errors++
      }
    } else {
      stats.imported++
    }
  }

  return stats
}

/** Map predictor source to the prediction_source column value */
function mapSource(source: string): string {
  switch (source) {
    case 'recurring_essential': return 'recurring_essential'
    case 'merchant_time': return 'merchant_rule'
    case 'merchant_amount': return 'merchant_rule'
    case 'merchant': return 'merchant_rule'
    case 'category_time': return 'category_rule'
    case 'category_amount': return 'category_rule'
    case 'category': return 'category_rule'
    case 'global': return 'global_rule'
    case 'user_confirmed': return 'user_confirmed'
    case 'category_default': return 'category_default'
    default: return 'category_default'
  }
}
