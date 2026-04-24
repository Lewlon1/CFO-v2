// /api/detect-format
//
// Format detection for the universal statement parser. Given a small
// SAMPLE of a user's bank export (first 5 CSV rows or the first 2 PDF
// pages' text), returns a FormatTemplate describing the column layout,
// date format, decimal convention, and sign convention.
//
// Privacy boundary:
//   - The full file never reaches this endpoint. Only the sample does.
//   - The sample may contain a handful of real transaction rows from
//     the user's statement. That's the cost of format detection; no
//     raw-sample payload is persisted to any table beyond the one-row
//     template cache. We explicitly do NOT store `sample` in the DB.
//
// Caching:
//   - Keyed by SHA-256 of sorted lowercased headers. Second upload of
//     the same bank format hits the cache and returns without any
//     Bedrock call (zero tokens, zero cost).
//
// Model: Haiku via the EU inference profile (utilityModel). Cost
// constraint — Sonnet would be overkill for structured extraction.

import { NextRequest, NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { z } from 'zod'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import type {
  FileType,
  FormatTemplate,
  SignConvention,
  DecimalFormat,
} from '@/lib/parsers/types'

export const runtime = 'nodejs'

const RequestSchema = z.object({
  // PDFs no longer hit this endpoint — they go direct to
  // /api/extract-pdf-transactions. XLSX is flattened to CSV client-side
  // and funnels through the `csv` path.
  fileType: z.enum(['csv', 'ofx', 'qif']),
  headerHash: z.string().regex(/^[0-9a-f]{64}$/, 'invalid sha256'),
  sample: z.string().min(1).max(20_000),
  filename: z.string().optional(),
})

// Haiku's structured output. Kept narrow — only what we need to
// populate a FormatTemplate row.
const DetectionSchema = z.object({
  bankName: z.string().nullable(),
  dateCol: z.string(),
  descriptionCol: z.string(),
  amountCol: z.string().nullable(),
  creditCol: z.string().nullable(),
  debitCol: z.string().nullable(),
  balanceCol: z.string().nullable(),
  currencyCol: z.string().nullable(),
  typeFlagCol: z.string().nullable(),
  typeFlagDebitValue: z.string().nullable(),
  typeFlagCreditValue: z.string().nullable(),
  dateFormat: z.string(),
  decimalFormat: z.enum(['dot', 'comma']),
  signConvention: z.enum(['signed_single_column', 'split_in_out', 'type_flag']),
  currencyDefault: z.string().min(3).max(3),
})

const DETECTION_PROMPT = `You are a bank-statement CSV format analyser for a personal finance app. Identify the column structure from the provided sample rows.

File type: {fileType}
Sample (first few rows):
---
{sample}
---

Return a JSON object matching the provided schema.

Column mapping:
- dateCol / descriptionCol: the EXACT column header names as they appear in the sample.
- amountCol MUST contain NUMERIC values in the sample data rows (e.g. "25", "-1000", "−4,99"). If the column you pick has free-text like "TRANSFER RECEIVED" or "COMPRA BIZUM" in the sample rows, it is NOT the amount column. Cross-check against the data rows before returning.
- Single signed amount column: set amountCol and signConvention = "signed_single_column".
- Separate credit + debit columns (e.g. Monzo "Money In" / "Money Out"): set creditCol + debitCol, signConvention = "split_in_out", amountCol = null.
- Magnitude column + DR/CR-style flag column: set amountCol + typeFlagCol + typeFlagDebitValue + typeFlagCreditValue, signConvention = "type_flag".
- balanceCol: running-balance column (e.g. Balance, Saldo). Null if absent.
- currencyCol: per-row currency column. Null if absent.

When multiple columns could plausibly be the description (e.g. "Reason" + "Movement"), prefer the more informative one (longer text, narrates the transaction). If in doubt, concatenate them downstream — but return the one that reads more like a merchant / narrative as descriptionCol.

Formatting:
- dateFormat: "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "ISO", or an explicit token like "DD-MM-YYYY".
- decimalFormat: "dot" when numbers look like 1,234.56 (UK/US); "comma" when 1.234,56 (ES/DE/FR).

Currency (IMPORTANT):
- currencyDefault is the PRIMARY account currency. It MUST be the currency of the statement-level balance or the account denomination — NOT the first currency that appears in a transaction row.
- Revolut multi-currency caveat: Revolut CSVs expose transactions in any wallet currency (EUR, GBP, USD) via a "Currency" column. The account base (and therefore currencyDefault) is the currency of the majority of balance values, NOT a minority wallet that happens to appear first.
- If the sample is genuinely ambiguous, prefer EUR or GBP based on locale cues (e.g. Spanish merchant names → EUR; UK sort codes / postcodes → GBP).

If a value is genuinely not present, return null.`

export async function POST(req: NextRequest) {
  // Auth — we don't care which user, but anonymous calls are rejected.
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

  const service = createServiceClient()

  // Cache hit — no LLM call, no Bedrock tokens, no cost. This is the
  // hot path; every upload after the first of any given format lands
  // here.
  const { data: existing } = await service
    .from('bank_format_templates')
    .select('*')
    .eq('header_hash', body.headerHash)
    .maybeSingle()

  if (existing) {
    await service
      .from('bank_format_templates')
      .update({
        use_count: (existing.use_count ?? 0) + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    return NextResponse.json({ template: rowToTemplate(existing) })
  }

  // Cache miss — ask Haiku to describe the format once, then cache it.
  const prompt = DETECTION_PROMPT.replace('{fileType}', body.fileType).replace(
    '{sample}',
    body.sample,
  )

  let detection: z.infer<typeof DetectionSchema>
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  const started = Date.now()
  try {
    const result = await generateObject({
      model: utilityModel,
      schema: DetectionSchema,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxOutputTokens: 500,
    })
    detection = result.object
    inputTokens = result.usage?.inputTokens
    outputTokens = result.usage?.outputTokens
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    console.error('[detect-format] Haiku detection failed:', raw)
    return NextResponse.json(
      { error: 'detection_failed', raw },
      { status: 422 },
    )
  } finally {
    void trackLLMUsage({
      userId: user.id,
      callType: 'format_detection',
      model: utilityModelId,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
      metadata: { fileType: body.fileType, headerHash: body.headerHash },
    })
  }

  const columnMapping: FormatTemplate['columnMapping'] = {
    date: detection.dateCol,
    description: detection.descriptionCol,
    amount: detection.amountCol ?? undefined,
    credit: detection.creditCol ?? undefined,
    debit: detection.debitCol ?? undefined,
    type_flag: detection.typeFlagCol ?? undefined,
    type_flag_values:
      detection.typeFlagDebitValue && detection.typeFlagCreditValue
        ? {
            debit: detection.typeFlagDebitValue,
            credit: detection.typeFlagCreditValue,
          }
        : undefined,
    currency: detection.currencyCol ?? undefined,
    balance: detection.balanceCol ?? undefined,
  }

  // Validate the detection is internally consistent — the sign
  // convention dictates which columns must be present. If Haiku returns
  // an inconsistent combo we fail loudly rather than write a broken
  // template that poisons the cache forever.
  const consistencyError = checkConsistency(detection.signConvention, columnMapping)
  if (consistencyError) {
    return NextResponse.json(
      { error: 'detection_failed', raw: consistencyError },
      { status: 422 },
    )
  }

  const firstRow = body.sample.split(/\r?\n/)[0] ?? ''

  const { data: inserted, error: insertError } = await service
    .from('bank_format_templates')
    .insert({
      header_hash: body.headerHash,
      bank_name: detection.bankName,
      file_type: body.fileType,
      column_mapping: columnMapping,
      sign_convention: detection.signConvention,
      date_format: detection.dateFormat,
      decimal_format: detection.decimalFormat,
      currency_default: detection.currencyDefault,
      sample_headers: firstRow,
      detection_source: 'llm',
      created_by_user_id: user.id,
    })
    .select('*')
    .single()

  if (insertError || !inserted) {
    // Race condition: another request may have inserted the same hash
    // between our lookup and insert. Fall through to a second read.
    const { data: refetched } = await service
      .from('bank_format_templates')
      .select('*')
      .eq('header_hash', body.headerHash)
      .maybeSingle()
    if (refetched) return NextResponse.json({ template: rowToTemplate(refetched) })
    console.error('[detect-format] template insert failed:', insertError)
    return NextResponse.json(
      { error: 'detection_failed', raw: insertError?.message ?? 'insert failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ template: rowToTemplate(inserted) })
}

type TemplateRow = {
  id: string
  header_hash: string
  bank_name: string | null
  file_type: FileType
  column_mapping: FormatTemplate['columnMapping']
  sign_convention: SignConvention
  date_format: string
  decimal_format: DecimalFormat
  currency_default: string
  sample_headers: string
  detection_source: 'llm' | 'manual' | 'user_confirmed'
  use_count: number
}

function rowToTemplate(row: TemplateRow): FormatTemplate {
  return {
    id: row.id,
    headerHash: row.header_hash,
    bankName: row.bank_name,
    fileType: row.file_type,
    columnMapping: row.column_mapping,
    signConvention: row.sign_convention,
    dateFormat: row.date_format,
    decimalFormat: row.decimal_format,
    currencyDefault: row.currency_default,
    sampleHeaders: row.sample_headers,
    detectionSource: row.detection_source,
    useCount: row.use_count,
  }
}

function checkConsistency(
  signConvention: SignConvention,
  mapping: FormatTemplate['columnMapping'],
): string | null {
  if (signConvention === 'signed_single_column' && !mapping.amount) {
    return 'signed_single_column requires an amount column'
  }
  if (signConvention === 'split_in_out' && (!mapping.credit || !mapping.debit)) {
    return 'split_in_out requires both credit and debit columns'
  }
  if (
    signConvention === 'type_flag' &&
    (!mapping.amount || !mapping.type_flag || !mapping.type_flag_values)
  ) {
    return 'type_flag requires amount + type_flag + type_flag_values'
  }
  return null
}
