import { generateText } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import type { ParsedTransaction, ParseResult } from './types'

const MODEL_ID =
  process.env.BEDROCK_CLAUDE_MODEL || 'eu.anthropic.claude-sonnet-4-6'

const EXTRACTION_PROMPT = `You are extracting transactions from a bank statement PDF.

Return ONLY a valid JSON array. No preamble, no explanation, no markdown fences.

Each transaction object must have exactly these fields:
{
  "date": "YYYY-MM-DD",
  "description": "original merchant/payee text as it appears",
  "amount": number (negative for debits/spending, positive for credits/income),
  "currency": "GBP" or "EUR" or other ISO 4217 code
}

Rules:
- Include ALL transactions visible in the document. Do not summarise or skip.
- Preserve the original description exactly as printed — do not clean or normalise it.
- Dates must be ISO 8601 (YYYY-MM-DD). If the year is ambiguous, infer from the statement period or surrounding context.
- Amounts: money leaving the account is NEGATIVE. Money arriving is POSITIVE.
- Handle UK date formats (DD/MM/YYYY) — convert to YYYY-MM-DD.
- Handle amounts with comma decimals (1.234,56 → 1234.56) or dot decimals (1,234.56 → 1234.56).
- Transfers between own accounts: include them, mark with original description.
- If currency is not shown, default to "GBP".
- Skip opening/closing balance lines, summary totals, interest summaries, and fee summary lines.
- If a field is genuinely missing or unreadable, skip that transaction entirely.
- If the document is not a bank statement or contains no transactions, return [].

Return only the JSON array. Nothing else.`

export async function parsePdfTransactions(
  buffer: ArrayBuffer,
  userId?: string,
): Promise<ParseResult> {
  try {
    const base64 = Buffer.from(buffer).toString('base64')

    const startTime = Date.now()
    const { text, usage } = await generateText({
      model: analysisModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              data: base64,
              mediaType: 'application/pdf',
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    })
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId,
      callType: 'pdf_transaction_parse',
      model: MODEL_ID,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      durationMs,
    })

    const cleaned = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return {
        ok: false,
        error: `PDF extraction returned invalid JSON. Raw start: ${cleaned.slice(0, 200)}`,
      }
    }

    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'PDF extraction did not return an array.' }
    }

    const transactions: ParsedTransaction[] = []

    for (const item of parsed) {
      if (!item.date || typeof item.amount !== 'number' || !item.description) continue
      transactions.push({
        date: String(item.date).slice(0, 10),
        description: String(item.description).trim(),
        amount: Number(item.amount),
        currency: String(item.currency || 'GBP').toUpperCase(),
        source: 'pdf_statement',
        raw_description: String(item.description).trim(),
      })
    }

    if (transactions.length === 0) {
      return {
        ok: false,
        error:
          'No transactions found in the PDF. This may be a scanned document or not a bank statement. Try exporting a CSV from your bank instead.',
      }
    }

    return { ok: true, transactions }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `PDF extraction failed: ${message}` }
  }
}
