import { generateText } from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import { sendAlert } from '@/lib/alerts/notify'
import { normaliseMerchant } from './normalise-merchant'
import type { Category } from '@/lib/parsers/types'

export type LLMCatResult = {
  index: number
  category_id: string
  confidence: number
  reasoning?: string
}

/**
 * Send up to 50 unmatched transactions to Bedrock for categorisation.
 * Returns an array of results indexed to the input array (1-based).
 */
export async function llmCategorise(
  descriptions: string[],
  categories: Category[],
  userId?: string
): Promise<LLMCatResult[]> {
  if (descriptions.length === 0) return []

  const categoryList = categories
    .map((c) => {
      const examples = c.examples.length > 0 ? ` Examples: ${c.examples.join(', ')}` : ''
      return `- ${c.id}: ${c.name} — ${c.description ?? ''}${examples}`
    })
    .join('\n')

  const txnList = descriptions
    .slice(0, 50)
    .map((d, i) => `${i + 1}. "${d}"`)
    .join('\n')

  const prompt = `Categorise each transaction into one of these categories:
${categoryList}

Transactions:
${txnList}

Return ONLY a JSON array. No other text.
Format: [{"index":1,"category_id":"groceries","confidence":0.85,"reasoning":"supermarket chain"}, ...]
Confidence range: 0.4 to 0.85 (never 1.0 — reserved for exact matches).
If you cannot confidently assign a category, omit that transaction from the result array.`

  const batchSize = descriptions.length
  let text: string | undefined

  try {
    const startTime = Date.now()
    const result = await generateText({
      model: utilityModel,
      messages: [{ role: 'user', content: prompt }],
    })
    text = result.text
    const usage = result.usage
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId,
      callType: 'categorisation',
      model: utilityModelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      durationMs,
      metadata: { transaction_count: descriptions.length },
    })

    logBedrockUsage({
      callSite: 'categorise',
      model: 'haiku',
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      userId,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    // Previously this path was silent — a Bedrock outage meant 100% of
    // uncategorised transactions stayed unclassified and `user_merchant_rules`
    // never grew. Alert so the failure is visible; still return [] so a bad
    // batch doesn't take the import down with it.
    const message = error instanceof Error ? error.message : String(error)
    console.error('[llm-categoriser] bedrock call failed', { error, batchSize, userId })
    void sendAlert({
      severity: 'critical',
      event: 'llm_categorisation_failed',
      user_id: userId,
      details: `Bedrock call failed for ${batchSize} transaction(s): ${message}`,
      metadata: { model: utilityModelId, batchSize },
    })
    return []
  }

  try {
    const cleaned = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    const parsed: LLMCatResult[] = JSON.parse(cleaned)

    const validIds = new Set(categories.map((c) => c.id))
    return parsed.filter(
      (r) =>
        typeof r.index === 'number' &&
        typeof r.category_id === 'string' &&
        validIds.has(r.category_id) &&
        typeof r.confidence === 'number'
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[llm-categoriser] parse failed', {
      error,
      batchSize,
      userId,
      responsePreview: text?.slice(0, 500),
    })
    void sendAlert({
      severity: 'warning',
      event: 'llm_categorisation_unparseable',
      user_id: userId,
      details: `Could not parse Haiku response (${batchSize} transactions): ${message}`,
      metadata: {
        model: utilityModelId,
        batchSize,
        responsePreview: text?.slice(0, 500),
      },
    })
    return []
  }
}

/**
 * Persist LLM-derived category decisions to user_merchant_rules so the next
 * upload for the same merchant is caught by the rules engine (Tier 1) without
 * another LLM call. Skips low-confidence rows and dedupes by normalised merchant.
 */
export async function saveLearnedMerchantRules(
  supabase: SupabaseClient,
  userId: string,
  descriptions: string[],
  results: LLMCatResult[],
  minConfidence = 0.7
): Promise<void> {
  if (!userId || results.length === 0) return

  const seen = new Set<string>()
  const rows: Array<{
    user_id: string
    normalised_merchant: string
    category_id: string
    confidence: number
    source: string
  }> = []

  for (const r of results) {
    if (r.confidence < minConfidence) continue
    const raw = descriptions[r.index - 1]
    if (!raw) continue
    const normalised = normaliseMerchant(raw)
    if (!normalised || seen.has(normalised)) continue
    seen.add(normalised)
    rows.push({
      user_id: userId,
      normalised_merchant: normalised,
      category_id: r.category_id,
      confidence: r.confidence,
      source: 'llm_fallback',
    })
  }

  if (rows.length === 0) return

  const { error } = await supabase
    .from('user_merchant_rules')
    .upsert(rows, { onConflict: 'user_id,normalised_merchant', ignoreDuplicates: false })

  if (error) {
    console.error('[llm-categoriser] failed to save merchant rules', {
      error,
      userId,
      count: rows.length,
    })
    void sendAlert({
      severity: 'critical',
      event: 'user_merchant_rules_upsert_failed',
      user_id: userId,
      details: `upsert of ${rows.length} merchant rule(s) failed: ${error.message}`,
      metadata: { code: error.code, details: error.details, rowCount: rows.length },
    })
  }
}
