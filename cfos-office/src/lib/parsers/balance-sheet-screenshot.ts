// Bedrock vision extraction for balance-sheet-type screenshots.
//
// Follows the `bill-extractor.ts` pattern: generateObject() with a Zod
// schema. Does NOT follow the older `screenshot.ts` generateText + JSON.parse
// pattern — Zod gives us structured validation for free.

import { generateObject } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import {
  balanceSheetDocumentSchema,
  BALANCE_SHEET_EXTRACTION_PROMPT,
  type BalanceSheetDocument,
} from './balance-sheet-schema'

const MODEL_ID =
  process.env.BEDROCK_CLAUDE_MODEL || 'global.anthropic.claude-sonnet-4-6'

export type BalanceSheetScreenshotResult =
  | { ok: true; data: BalanceSheetDocument }
  | { ok: false; error: string }

export async function parseBalanceSheetScreenshot(
  imageBase64DataUrl: string,
  userId?: string
): Promise<BalanceSheetScreenshotResult> {
  try {
    const startTime = Date.now()
    const { object, usage } = await generateObject({
      model: analysisModel,
      schema: balanceSheetDocumentSchema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: imageBase64DataUrl },
            { type: 'text', text: BALANCE_SHEET_EXTRACTION_PROMPT },
          ],
        },
      ],
    })
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId,
      callType: 'balance_sheet_screenshot_parse',
      model: MODEL_ID,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      durationMs,
    })

    if (object.document_type === 'unknown') {
      return {
        ok: false,
        error:
          "That doesn't look like a financial document I can parse. Try a screenshot of a portfolio, pension, loan, savings, or credit card statement.",
      }
    }

    return { ok: true, data: object }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[balance-sheet-screenshot] extraction failed:', message)
    return { ok: false, error: `Vision extraction failed: ${message}` }
  }
}
