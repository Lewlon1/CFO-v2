// scripts/parse-diagnose.ts
//
// Observational CLI: runs bank statement fixtures through the universal
// parser pipeline and prints a diagnostic report. Dev tool only — no
// Supabase writes, no persistence.
//
// Usage:
//   npx tsx scripts/parse-diagnose.ts tests/fixtures/revolut_2026-03.csv
//   npx tsx scripts/parse-diagnose.ts --all
//   npx tsx scripts/parse-diagnose.ts --all --dir tests/fixtures
//
// Pipeline:
//   CSV  → Haiku format detection inline → parseUniversalCSV
//   XLSX → xlsx flatten to CSV text      → same CSV path
//   PDF  → pdf-parse text extraction → Haiku with text-based extraction
//          prompt. NOTE: production uses vision (browser renders pages
//          to PNG → /api/extract-pdf-transactions). The CLI uses text
//          because pdfjs-dist + @napi-rs/canvas can't render PDFs with
//          subsetted fonts in Node. Same Haiku, same schema, same rules
//          — different input modality. Signal is comparable but not
//          identical; verify the production path via the dev server UI.
//   OFX/QIF → deterministic parse
//
// Auth + Supabase caching are intentionally bypassed; every run pays
// fresh Haiku tokens. That's fine for an 8-fixture diagnostic.

import { readFileSync } from 'fs'
import { resolve, basename, extname, join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { performance } from 'perf_hooks'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import Papa from 'papaparse'
import { PDFParse } from 'pdf-parse'

// ── Load .env.local before any module reads env ──────────────────────
try {
  const envFile = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // No .env.local — assume process.env already has what we need.
}

const originalLog = console.log
console.log = (...args: unknown[]) => {
  const first = args[0]
  if (typeof first === 'string' && first.startsWith('[bedrock]')) return
  originalLog(...args)
}

import { utilityModel } from '../src/lib/ai/provider'
import { computeHeaderHash, extractCsvSample } from '../src/lib/parsers/fingerprint'
import { parseUniversalCSV, repairTemplate } from '../src/lib/parsers/universal-csv'
import { parseOFX } from '../src/lib/parsers/ofx'
import { parseQIF } from '../src/lib/parsers/qif'
import { xlsxBufferToCSV } from '../src/lib/parsers/xlsx-to-csv'
import type {
  FileType,
  FormatTemplate,
  ParsedTransaction,
  SignConvention,
  DecimalFormat,
} from '../src/lib/parsers/types'

import { formatDiagnosis, formatSummaryTable } from './parse-diagnose-report'
import type { Diagnosis } from './parse-diagnose-report'

// ── Inline format detection (mirrors /api/detect-format) ─────────────

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

File type: csv
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

When multiple columns could plausibly be the description, prefer the more informative one (longer text, narrates the transaction).

Formatting:
- dateFormat: "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "ISO", or an explicit token like "DD-MM-YYYY".
- decimalFormat: "dot" when numbers look like 1,234.56 (UK/US); "comma" when 1.234,56 (ES/DE/FR).

Currency (IMPORTANT):
- currencyDefault is the PRIMARY account currency, NOT the first per-row currency.
- Revolut multi-currency caveat: pick the majority balance currency, not a minority wallet.
- If ambiguous, use locale cues (Spanish merchants → EUR; UK sort codes → GBP).

If a value is genuinely not present, return null.`

async function detectCsvFormat(sample: string, headerHash: string): Promise<FormatTemplate> {
  const prompt = DETECTION_PROMPT.replace('{sample}', sample)

  const { object } = await generateObject({
    model: utilityModel,
    schema: DetectionSchema,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxOutputTokens: 500,
  })

  return {
    headerHash,
    bankName: object.bankName,
    fileType: 'csv',
    columnMapping: {
      date: object.dateCol,
      description: object.descriptionCol,
      amount: object.amountCol ?? undefined,
      credit: object.creditCol ?? undefined,
      debit: object.debitCol ?? undefined,
      type_flag: object.typeFlagCol ?? undefined,
      type_flag_values:
        object.typeFlagDebitValue && object.typeFlagCreditValue
          ? { debit: object.typeFlagDebitValue, credit: object.typeFlagCreditValue }
          : undefined,
      currency: object.currencyCol ?? undefined,
      balance: object.balanceCol ?? undefined,
    },
    signConvention: object.signConvention as SignConvention,
    dateFormat: object.dateFormat,
    decimalFormat: object.decimalFormat as DecimalFormat,
    currencyDefault: object.currencyDefault,
    sampleHeaders: '',
    detectionSource: 'llm' as const,
  }
}

// ── Inline PDF text extraction + Haiku (observational variant) ───────
// Production path: browser renders pages → Haiku vision. CLI path:
// pdf-parse extracts text → Haiku on text. Different modality, same
// prompt family + model. Good enough for "does this PDF produce
// sensible transactions?" diagnostics.

const PdfSchema = z.object({
  transactions: z.array(
    z.object({
      date: z.string(),
      description: z.string(),
      amount: z.number(),
      balance: z.number().nullable().optional(),
    }),
  ),
  openingBalance: z.number().nullable().optional(),
  closingBalance: z.number().nullable().optional(),
  statementPeriodStart: z.string().nullable().optional(),
  statementPeriodEnd: z.string().nullable().optional(),
  accountCurrency: z.string().nullable().optional(),
})

const PDF_EXTRACTION_PROMPT = `You are extracting every transaction from a bank statement. The statement is provided as plain text extracted from the PDF — column structure may be lost; infer it from context.

Return ONLY a JSON object — no markdown fences, no prose.

{
  "transactions": [{ "date": "YYYY-MM-DD", "description": "…", "amount": -42.50, "balance": 1250.00 }],
  "openingBalance": 1250.00,
  "closingBalance": 999.00,
  "statementPeriodStart": "YYYY-MM-DD",
  "statementPeriodEnd": "YYYY-MM-DD",
  "accountCurrency": "EUR"
}

Transaction rules:
- Debits (money OUT) MUST be negative. Credits (money IN) MUST be positive.
- Dates MUST be ISO 8601 (YYYY-MM-DD). Convert DD/MM/YYYY or "1 Mar 2026" if needed.
- Join multi-line descriptions with a single space.
- Skip any row with no numeric amount.

Rows to SKIP:
- Opening / closing balance rows, "Balance brought/carried forward"
- Running subtotals, totals, "Total debits/credits", "Summary"
- Column headers
- Promotional text, disclaimers, page numbers, footers, legal boilerplate

Metadata rules:
- openingBalance / closingBalance: statement-level bounds (cover page or last page). NOT a per-transaction running balance.
- statementPeriodStart / End: declared statement period.
- accountCurrency: PRIMARY account currency (from header / IBAN / account details). For multi-wallet apps like Revolut, use the base account currency, NOT a sub-wallet transaction's currency.
- Return null for any field genuinely not in the text.

Statement text:
---
{TEXT}
---`

type PdfExtractionResult = {
  transactions: ParsedTransaction[]
  metadata: {
    openingBalance: number | null
    closingBalance: number | null
    statementPeriodStart: string | null
    statementPeriodEnd: string | null
    accountCurrency: string | null
  }
  warnings: string[]
}

async function extractPdfViaText(filepath: string, fallbackCurrency: string): Promise<PdfExtractionResult> {
  const buf = await readFile(filepath)
  const parser = new PDFParse({ data: buf })
  const { text } = await parser.getText()

  // Trim if wildly over the context window. ~4 chars/token; 60K chars
  // ~= 15K tokens, still fine. Hard cap at 200K chars (50K tokens).
  const capped = text.length > 200_000 ? text.slice(0, 200_000) + '\n[...truncated]' : text

  const prompt = PDF_EXTRACTION_PROMPT.replace('{TEXT}', capped)

  const { text: raw } = await generateText({
    model: utilityModel,
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens: 16000,
  })

  const cleaned = raw
    .trim()
    .replace(/^```json\n?/i, '')
    .replace(/^```\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()

  let parsed: z.infer<typeof PdfSchema>
  try {
    parsed = PdfSchema.parse(JSON.parse(cleaned))
  } catch (err) {
    return {
      transactions: [],
      metadata: {
        openingBalance: null, closingBalance: null,
        statementPeriodStart: null, statementPeriodEnd: null,
        accountCurrency: null,
      },
      warnings: [`extraction_parse_failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  const accountCurrency = parsed.accountCurrency ? parsed.accountCurrency.toUpperCase() : null

  const txMap = new Map<string, ParsedTransaction>()
  for (const item of parsed.transactions) {
    const date = item.date.slice(0, 10)
    const description = item.description.trim()
    const amount = item.amount
    if (!date || !description || !Number.isFinite(amount) || amount === 0) continue
    const key = `${date}|${amount}|${description.toLowerCase()}`
    if (txMap.has(key)) continue
    txMap.set(key, {
      date: `${date}T00:00:00Z`,
      description,
      amount,
      currency: accountCurrency ?? fallbackCurrency,
      source: 'pdf_vision',  // align with production source tag
      raw_description: description,
      balance: typeof item.balance === 'number' && Number.isFinite(item.balance) ? item.balance : null,
    })
  }

  const transactions = Array.from(txMap.values())
  const warnings: string[] = []
  if (typeof parsed.openingBalance === 'number' && typeof parsed.closingBalance === 'number') {
    const sum = transactions.reduce((acc, t) => acc + t.amount, 0)
    if (Math.abs(sum - (parsed.closingBalance - parsed.openingBalance)) >= 0.01) {
      warnings.push('balance_mismatch')
    }
  }

  return {
    transactions,
    metadata: {
      openingBalance: parsed.openingBalance ?? null,
      closingBalance: parsed.closingBalance ?? null,
      statementPeriodStart: parsed.statementPeriodStart ?? null,
      statementPeriodEnd: parsed.statementPeriodEnd ?? null,
      accountCurrency,
    },
    warnings,
  }
}

// ── File type dispatch ───────────────────────────────────────────────

function fileTypeFromName(filename: string): FileType | 'image' | 'unsupported' {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv') return 'csv'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'ofx') return 'ofx'
  if (ext === 'qif') return 'qif'
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (['png', 'jpg', 'jpeg', 'heic', 'webp'].includes(ext)) return 'image'
  return 'unsupported'
}

async function diagnoseTabular(
  csvText: string,
  formatLabel: string,
  base: Diagnosis,
  started: number,
): Promise<Diagnosis> {
  base.format = formatLabel
  const preview = Papa.parse<Record<string, string>>(csvText, { header: true, preview: 1 })
  const headers = preview.meta.fields ?? []
  if (headers.length === 0) {
    base.error = 'No headers detected'
    base.parseMs = performance.now() - started
    return base
  }
  const hash = await computeHeaderHash(headers)
  const sample = extractCsvSample(csvText, 5)
  const rawTemplate = await detectCsvFormat(sample, hash)
  const template = repairTemplate(csvText, rawTemplate)
  base.template = {
    bankName: template.bankName,
    signConvention: template.signConvention,
    dateFormat: template.dateFormat,
    decimalFormat: template.decimalFormat,
    currencyDefault: template.currencyDefault,
  }
  const r = parseUniversalCSV(csvText, template)
  base.parseMs = performance.now() - started
  if (!r.ok) {
    base.error = r.error
    base.warnings = r.warnings ?? []
  } else {
    base.ok = true
    base.transactions = r.transactions
    base.warnings = r.warnings
    base.skippedRows = r.skippedRows
  }
  return base
}

async function diagnose(filepath: string): Promise<Diagnosis> {
  const filename = basename(filepath)
  const started = performance.now()
  const statResult = await stat(filepath)
  const sizeBytes = statResult.size
  const extension = extname(filepath).toLowerCase()
  const fileType = fileTypeFromName(filename)

  const base: Diagnosis = {
    filename,
    sizeBytes,
    extension,
    format: 'unknown',
    fallbackPath: false,
    parseMs: 0,
    ok: false,
    warnings: [],
    transactions: [],
    skippedRows: 0,
  }

  try {
    if (fileType === 'unsupported') {
      base.format = 'unsupported'
      base.fallbackPath = true
      base.error = `Unsupported extension: ${extension}`
      base.parseMs = performance.now() - started
      return base
    }

    if (fileType === 'image') {
      base.format = 'image_out_of_scope'
      base.fallbackPath = true
      base.error = 'Images use the separate screenshot parser, not the universal pipeline'
      base.parseMs = performance.now() - started
      return base
    }

    if (fileType === 'ofx') {
      const text = await readFile(filepath, 'utf-8')
      const r = parseOFX(text)
      base.format = 'ofx'
      base.parseMs = performance.now() - started
      if (!r.ok) base.error = r.error
      else { base.ok = true; base.transactions = r.transactions }
      return base
    }

    if (fileType === 'qif') {
      const text = await readFile(filepath, 'utf-8')
      const r = parseQIF(text)
      base.format = 'qif'
      base.parseMs = performance.now() - started
      if (!r.ok) base.error = r.error
      else { base.ok = true; base.transactions = r.transactions }
      return base
    }

    if (fileType === 'csv') {
      const text = await readFile(filepath, 'utf-8')
      return diagnoseTabular(text, 'csv_universal', base, started)
    }

    if (fileType === 'xlsx') {
      const buf = await readFile(filepath)
      const csv = xlsxBufferToCSV(buf)
      if (!csv || csv.trim().length === 0) {
        base.format = 'xlsx_empty'
        base.error = 'XLSX first sheet is empty'
        base.parseMs = performance.now() - started
        return base
      }
      return diagnoseTabular(csv, 'xlsx_universal', base, started)
    }

    if (fileType === 'pdf') {
      base.format = 'pdf_text_haiku'
      const result = await extractPdfViaText(filepath, 'GBP')
      base.parseMs = performance.now() - started
      base.ok = result.transactions.length > 0
      base.transactions = result.transactions
      base.warnings = result.warnings
      base.openingBalance = result.metadata.openingBalance
      base.closingBalance = result.metadata.closingBalance
      base.periodStart = result.metadata.statementPeriodStart
      base.periodEnd = result.metadata.statementPeriodEnd
      base.template = {
        bankName: null,
        signConvention: 'signed_single_column',
        dateFormat: 'ISO',
        decimalFormat: 'dot',
        currencyDefault: result.metadata.accountCurrency ?? 'GBP',
      }
      // Mark the CLI's PDF path as "fallback" — it's observational, not
      // the production vision path.
      base.fallbackPath = true
      if (!base.ok) base.error = 'Text-based extraction returned no transactions'
      return base
    }

    base.error = `Unhandled file type: ${fileType}`
    base.parseMs = performance.now() - started
    return base
  } catch (err) {
    base.parseMs = performance.now() - started
    base.error = err instanceof Error ? err.message : String(err)
    return base
  }
}

// ── Entry point ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const allFlag = args.includes('--all')
  const dirIdx = args.indexOf('--dir')
  const dir = dirIdx !== -1 ? args[dirIdx + 1] : 'tests/fixtures'
  const singleFile = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--dir')

  const cwd = process.cwd()
  let files: string[] = []

  if (allFlag) {
    const dirPath = resolve(cwd, dir)
    try {
      const entries = await readdir(dirPath)
      files = entries
        .filter((e) => !e.startsWith('.'))
        .filter((e) => fileTypeFromName(e) !== 'unsupported')
        .sort()
        .map((e) => join(dirPath, e))
    } catch (err) {
      console.error(`Cannot read directory ${dirPath}:`, err instanceof Error ? err.message : err)
      process.exit(1)
    }
  } else if (singleFile) {
    files = [resolve(cwd, singleFile)]
  } else {
    console.error('Usage:')
    console.error('  npx tsx scripts/parse-diagnose.ts <file>')
    console.error('  npx tsx scripts/parse-diagnose.ts --all [--dir <dir>]')
    process.exit(1)
  }

  if (files.length === 0) {
    console.error(`No parseable files found in ${dir}`)
    process.exit(1)
  }

  const results: Diagnosis[] = []
  for (const f of files) {
    process.stderr.write(`Diagnosing ${basename(f)}...\n`)
    const d = await diagnose(f)
    results.push(d)
  }

  if (results.length > 1) {
    console.log(formatSummaryTable(results))
  }
  for (const d of results) {
    console.log(formatDiagnosis(d))
  }

  const threw = results.filter((r) => !r.ok && r.error?.startsWith('Error')).length
  process.exit(threw > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
