import { generateText } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
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
If genuinely uncertain use "shopping" as fallback.`

  try {
    const startTime = Date.now()
    const { text, usage } = await generateText({
      model: analysisModel,
      messages: [{ role: 'user', content: prompt }],
    })
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId,
      callType: 'categorisation',
      model: 'eu.anthropic.claude-sonnet-4-6',
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      durationMs,
      metadata: { transaction_count: descriptions.length },
    })

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
  } catch {
    return []
  }
}
