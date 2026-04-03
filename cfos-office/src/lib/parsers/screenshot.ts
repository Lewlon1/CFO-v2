import { generateText } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import type { ParsedTransaction, ParseResult } from './types'

const EXTRACTION_PROMPT = `You are extracting bank transactions from a screenshot.

Return ONLY a JSON array of transactions. No other text, no markdown, no explanation.

Each transaction object must have:
- "date": string in ISO format YYYY-MM-DD
- "description": string (merchant or description)
- "amount": number (NEGATIVE for expenses/debits, POSITIVE for income/credits)
- "currency": string ISO code e.g. "EUR", "GBP"

Rules:
- Handle Spanish date format DD/MM/YYYY → convert to YYYY-MM-DD
- Handle Spanish amounts with comma decimals: 1.234,56 → 1234.56
- If a date is unclear, use your best guess
- If currency is not shown, use "EUR"
- If amount sign is unclear, use negative (assume expense)
- Skip any rows that are clearly headers, totals, or balance lines
- Extract only actual transaction rows

Return format example:
[{"date":"2026-03-15","description":"Mercadona","amount":-45.20,"currency":"EUR"}]`

export async function parseScreenshot(imageBase64: string): Promise<ParseResult> {
  try {
    const { text } = await generateText({
      model: analysisModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: imageBase64 },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    })

    const cleaned = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'Unexpected response format from vision model.' }
    }

    const transactions: ParsedTransaction[] = []

    for (const item of parsed) {
      if (!item.date || typeof item.amount !== 'number' || !item.description) continue
      transactions.push({
        date: String(item.date).slice(0, 10),
        description: String(item.description).trim(),
        amount: Number(item.amount),
        currency: String(item.currency || 'EUR').toUpperCase(),
        source: 'screenshot',
        raw_description: String(item.description).trim(),
      })
    }

    if (transactions.length === 0) {
      return { ok: false, error: 'No transactions could be extracted from the image.' }
    }

    return { ok: true, transactions }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Vision extraction failed: ${message}` }
  }
}
