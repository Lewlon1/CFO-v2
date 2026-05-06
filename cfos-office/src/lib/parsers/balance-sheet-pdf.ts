// Text-based PDF extraction for balance sheet documents.
//
// Strategy: pull text out of the PDF with `pdf-parse`, then send the text
// to Claude via generateObject() + the shared Zod schema. Scanned / image-only
// PDFs (where extracted text is effectively empty) get a helpful error
// asking for a screenshot instead — full OCR can come later.
//
// SERVER-ONLY. Never import from a client component.

import { generateObject } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import {
  balanceSheetDocumentSchema,
  BALANCE_SHEET_EXTRACTION_PROMPT,
  type BalanceSheetDocument,
} from './balance-sheet-schema'

const MODEL_ID =
  process.env.BEDROCK_CLAUDE_MODEL || 'eu.anthropic.claude-sonnet-4-6'

// Keep well under Claude's context budget — 15k chars ≈ ~3.5k tokens.
const MAX_PDF_TEXT_CHARS = 15_000

// Below this, we assume the PDF is scanned/image-only and has no text layer.
const MIN_TEXT_CHARS = 50

export type BalanceSheetPdfResult =
  | { ok: true; data: BalanceSheetDocument }
  | { ok: false; error: string }

export async function parseBalanceSheetPDF(
  buffer: ArrayBuffer,
  userId?: string
): Promise<BalanceSheetPdfResult> {
  let text: string
  let parser: InstanceType<typeof import('pdf-parse').PDFParse> | null = null
  try {
    // Dynamic import keeps pdf-parse out of the client bundle. v2 exposes
    // a PDFParse class rather than a default-export function.
    const { PDFParse } = await import('pdf-parse')
    parser = new PDFParse({ data: new Uint8Array(buffer) })
    const result = await parser.getText()
    text = (result.text ?? '').trim()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Could not read PDF: ${message}` }
  } finally {
    if (parser) {
      try {
        await parser.destroy()
      } catch {
        // Cleanup-only finally: swallowing destroy errors is intentional —
        // we've already returned the parse result (success or failure) and
        // can't surface a destroy-time failure usefully. The parser is
        // local to this call so a leak here is bounded to one invocation.
      }
    }
  }

  if (text.length < MIN_TEXT_CHARS) {
    return {
      ok: false,
      error:
        'This PDF appears to be scanned or image-only, so I can\'t read the text. Please upload a screenshot of the relevant page instead.',
    }
  }

  const sliced = text.slice(0, MAX_PDF_TEXT_CHARS)

  try {
    const startTime = Date.now()
    const { object, usage } = await generateObject({
      model: analysisModel,
      schema: balanceSheetDocumentSchema,
      messages: [
        {
          role: 'user',
          content:
            BALANCE_SHEET_EXTRACTION_PROMPT +
            '\n\nDocument text follows:\n---\n' +
            sliced +
            '\n---',
        },
      ],
    })
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId,
      callType: 'balance_sheet_pdf_parse',
      model: MODEL_ID,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      durationMs,
      metadata: { chars: sliced.length },
    })

    if (object.document_type === 'unknown') {
      return {
        ok: false,
        error:
          "I couldn't identify that as a financial document. Try a portfolio, pension, loan, savings, or credit card statement PDF.",
      }
    }

    return { ok: true, data: object }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[balance-sheet-pdf] extraction failed:', message)
    return { ok: false, error: `PDF extraction failed: ${message}` }
  }
}
