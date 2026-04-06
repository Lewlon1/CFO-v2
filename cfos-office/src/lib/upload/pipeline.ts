import type { SupabaseClient } from '@supabase/supabase-js'
import { categoriseByRules } from '@/lib/categorisation/rules-engine'
import { llmCategorise } from '@/lib/categorisation/llm-categoriser'
import { assignValueCategory } from '@/lib/categorisation/value-categoriser'
import { loadExistingKeys, isDuplicate } from './duplicate-detector'
import type { ParsedTransaction, Category, ValueCategoryRule } from '@/lib/parsers/types'

export type PipelineStats = {
  imported: number
  duplicates: number
  errors: number
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
  needsLLM: boolean
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

  // Load reference data
  const { data: catData } = await supabase
    .from('categories')
    .select('id, name, tier, icon, color, examples, default_value_category')
    .eq('is_active', true)
  const categories: Category[] = catData ?? []

  const { data: rulesData } = await supabase
    .from('value_category_rules')
    .select('match_type, match_value, value_category, confidence, source')
    .eq('user_id', opts.userId)
  const userRules: ValueCategoryRule[] = rulesData ?? []

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

    // Use user-preset categories from preview if provided
    if (txn.presetCategoryId !== undefined || txn.presetValueCategory !== undefined) {
      const categoryId = txn.presetCategoryId !== undefined ? txn.presetCategoryId : null
      const valResult = txn.presetValueCategory
        ? { valueCategory: txn.presetValueCategory }
        : assignValueCategory(txn.description, categoryId, userRules, categories)
      toInsert.push({
        ...txn,
        categoryId,
        confidence: 1.0,
        valueCategory: valResult.valueCategory,
        needsLLM: false,
      })
      continue
    }

    const catResult = categoriseByRules(txn.description, categories)
    const valResult = assignValueCategory(
      txn.description, catResult.categoryId, userRules, categories
    )

    toInsert.push({
      ...txn,
      categoryId: catResult.categoryId,
      confidence: catResult.confidence,
      valueCategory: valResult.valueCategory,
      needsLLM: catResult.categoryId === null,
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
        const valResult = assignValueCategory(
          txn.description, txn.categoryId, userRules, categories
        )
        txn.valueCategory = valResult.valueCategory
      }
    }
  }

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
