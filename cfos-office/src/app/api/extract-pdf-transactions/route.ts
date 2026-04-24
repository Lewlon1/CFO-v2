// /api/extract-pdf-transactions
//
// Strategy B of the universal PDF parser. Used only when the client
// can't extract a usable text layer (scanned PDFs, unusual layouts).
// The client renders pages 1-3 to PNG, POSTs them here, we run Haiku
// vision through the EU inference profile and return ParsedTransaction[].
//
// Privacy: this endpoint does receive rendered page images from the
// user's statement. It is explicitly separate from format detection —
// callers (universal-pdf.ts) only invoke it after Strategy A has
// failed, and every invocation is logged via trackLLMUsage so usage is
// visible in llm_usage_log.
//
// Sign convention: we instruct Haiku to return signed amounts
// (debits negative, credits positive) and double-check in validation.

import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { z } from 'zod'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { createClient } from '@/lib/supabase/server'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import type { ParsedTransaction } from '@/lib/parsers/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const RequestSchema = z.object({
  // Each image is a data URL — "data:image/png;base64,..."
  images: z.array(z.string().min(32)).min(1).max(5),
  currencyDefault: z.string().min(3).max(3).optional(),
})

const EXTRACTION_PROMPT = `Extract all transactions from this bank statement page.
Return ONLY a JSON array — no explanation, no markdown fences.

[
  {
    "date": "YYYY-MM-DD",
    "description": "merchant or transaction description",
    "amount": -42.50,
    "balance": 1250.00
  }
]

Rules:
- Debits (money out) MUST be negative numbers.
- Credits (money in) MUST be positive numbers.
- Dates MUST be ISO 8601 (YYYY-MM-DD).
- Skip header rows, balance summaries, totals, and non-transaction lines.
- If balance is not shown, omit the field.
- If a field is genuinely missing, skip the transaction.
- If the page has no transactions, return [].`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof RequestSchema>
  try {
    body = RequestSchema.parse(await req.json())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request'
    return NextResponse.json({ error: 'bad_request', detail: message }, { status: 400 })
  }

  const currency = (body.currencyDefault ?? 'GBP').toUpperCase()
  const transactionsByKey = new Map<string, ParsedTransaction>()

  for (let i = 0; i < body.images.length; i++) {
    const dataUrl = body.images[i]
    const base64 = extractBase64(dataUrl)
    if (!base64) continue

    const started = Date.now()
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let text: string
    try {
      const result = await generateText({
        model: utilityModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: base64, mediaType: 'image/png' },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          },
        ],
        maxOutputTokens: 2000,
      })
      text = result.text
      inputTokens = result.usage?.inputTokens
      outputTokens = result.usage?.outputTokens
    } catch (err) {
      console.error('[extract-pdf-transactions] Haiku vision failed:', err)
      continue
    } finally {
      void trackLLMUsage({
        userId: user.id,
        callType: 'pdf_vision_extraction',
        model: utilityModelId,
        inputTokens,
        outputTokens,
        durationMs: Date.now() - started,
        metadata: { pageIndex: i, pageCount: body.images.length },
      })
    }

    const cleaned = text
      .trim()
      .replace(/^```json\n?/i, '')
      .replace(/^```\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const date = typeof obj.date === 'string' ? obj.date.slice(0, 10) : ''
      const description = typeof obj.description === 'string' ? obj.description.trim() : ''
      const amount = typeof obj.amount === 'number' ? obj.amount : NaN
      if (!date || !description || !Number.isFinite(amount) || amount === 0) continue

      // Deduplicate across pages: same date + amount + description.
      const key = `${date}|${amount}|${description.toLowerCase()}`
      if (transactionsByKey.has(key)) continue

      const balanceRaw = obj.balance
      const balance = typeof balanceRaw === 'number' && Number.isFinite(balanceRaw) ? balanceRaw : null

      transactionsByKey.set(key, {
        date: `${date}T00:00:00Z`,
        description,
        amount,
        currency,
        source: 'pdf_vision',
        raw_description: description,
        balance,
      })
    }
  }

  const transactions = Array.from(transactionsByKey.values())
  return NextResponse.json({ transactions })
}

function extractBase64(dataUrl: string): string | null {
  const m = dataUrl.match(/^data:image\/[a-zA-Z+]+;base64,(.*)$/)
  if (m) return m[1]
  // Already raw base64?
  if (/^[A-Za-z0-9+/=]+$/.test(dataUrl)) return dataUrl
  return null
}
