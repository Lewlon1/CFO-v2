import { generateText } from "ai"
import { google } from "@ai-sdk/google"

export type AICategoryResult = {
  categoryName: string
  confidence: "high" | "medium" | "low"
}

const BATCH_SIZE = 20
const TIMEOUT_MS = 5_000

const SYSTEM_PROMPT =
  `You are a financial transaction categoriser. Given a list of merchant names from bank statements, classify each into exactly one of these categories: {CATEGORIES}. Respond with JSON only, no markdown. Format: { "results": [{ "merchant": "...", "category": "...", "confidence": "high|medium|low" }] }. If you cannot determine the category, use "Other expense" with confidence "low". Consider the merchant name, transaction amount, and type (expense/income) when classifying.`

interface MerchantInput {
  text: string
  amount: number
  type: string
}

interface AIResultItem {
  merchant: string
  category: string
  confidence: string
}

async function categoriseBatch(
  merchants: MerchantInput[],
  availableCategories: string[]
): Promise<Map<string, AICategoryResult>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const systemPrompt = SYSTEM_PROMPT.replace(
      "{CATEGORIES}",
      availableCategories.join(", ")
    )

    const userPrompt = JSON.stringify(
      merchants.map((m) => ({
        merchant: m.text,
        amount: m.amount,
        type: m.type,
      }))
    )

    const { text } = await generateText({
      model: google("gemini-2.0-flash"),
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: controller.signal,
    })

    const parsed: { results: AIResultItem[] } = JSON.parse(text)
    const resultMap = new Map<string, AICategoryResult>()

    for (const item of parsed.results ?? []) {
      const confidence = item.confidence as AICategoryResult["confidence"]
      if (confidence === "high" || confidence === "medium") {
        resultMap.set(item.merchant, { categoryName: item.category, confidence })
      }
    }
    return resultMap
  } catch {
    return new Map()
  } finally {
    clearTimeout(timer)
  }
}

export async function aiCategoriseBatch(
  merchants: MerchantInput[],
  availableCategories: string[]
): Promise<Map<string, AICategoryResult>> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return new Map()
  if (merchants.length === 0) return new Map()

  const combined = new Map<string, AICategoryResult>()

  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    const batchResult = await categoriseBatch(
      merchants.slice(i, i + BATCH_SIZE),
      availableCategories
    )
    for (const [key, val] of batchResult) {
      combined.set(key, val)
    }
  }

  return combined
}
