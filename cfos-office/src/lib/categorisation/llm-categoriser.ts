import { generateText } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import type { Category } from '@/lib/parsers/types'

export type LLMCatResult = {
  index: number
  category_id: string
  confidence: number
}

/**
 * Send up to 50 unmatched transactions to Bedrock for categorisation.
 * Returns an array of results indexed to the input array (1-based).
 */
export async function llmCategorise(
  descriptions: string[],
  categories: Category[]
): Promise<LLMCatResult[]> {
  if (descriptions.length === 0) return []

  const categoryList = categories
    .map((c) => `- ${c.id}: ${c.name} — ${c.description ?? ''}`)
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
Format: [{"index":1,"category_id":"groceries","confidence":0.85}, ...]
Confidence range: 0.4 to 0.85 (never 1.0 — reserved for exact matches).
If genuinely uncertain use "shopping" as fallback.`

  try {
    const { text } = await generateText({
      model: analysisModel,
      messages: [{ role: 'user', content: prompt }],
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
