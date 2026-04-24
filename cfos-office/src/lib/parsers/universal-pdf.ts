// Universal PDF parser — runs on the client using pdfjs-dist.
//
// Two strategies:
//
// Strategy A (text extraction): for PDFs with a real text layer (Monzo,
// Lloyds, NatWest, Halifax, etc.) we extract text items with position
// data, cluster by Y coordinate to reconstruct rows, then apply the
// detected FormatTemplate. No Bedrock call.
//
// Strategy B (vision fallback): for scanned/image-only PDFs (some
// Spanish banks, legacy paper statements) Strategy A yields little or
// nothing. We render pages 1-3 to PNG on the client and POST the images
// to /api/extract-pdf-transactions, which runs Haiku vision via the EU
// inference profile. Strategy B is explicitly authorised here — images
// do leave the browser — which is different from the format-detection
// privacy promise. Fire a log line whenever B triggers.

import type {
  FormatTemplate,
  ParsedTransaction,
  UniversalParseResult,
} from './types'
import { parseAmount, parseDate } from './universal-csv'

const STRATEGY_B_MIN_ROWS = 5
const STRATEGY_B_MIN_CHARS_PER_PAGE = 50
const STRATEGY_B_MAX_PAGES = 3
const ROW_Y_TOLERANCE = 2 // PDF user-space units

type PdfText = {
  pages: { text: string; rows: string[][] }[]
  textChars: number
}

// Extract a sample (first 2 pages' reconstructed text) for format
// detection. The sample is what gets POSTed to /api/detect-format.
export async function extractPdfSample(file: File): Promise<string> {
  const extracted = await extractPdfText(file, 2)
  return extracted.pages
    .map((p, i) => `--- page ${i + 1} ---\n${p.text}`)
    .join('\n\n')
}

// Main entry point. Runs Strategy A first; falls back to Strategy B
// when A looks empty or sparse. Strategy B is triggered here with a
// POST to the server-side vision endpoint.
export async function parseUniversalPDF(
  file: File,
  template: FormatTemplate,
): Promise<UniversalParseResult> {
  const extracted = await extractPdfText(file)

  const sparse =
    extracted.pages.length === 0 ||
    extracted.textChars < STRATEGY_B_MIN_CHARS_PER_PAGE * extracted.pages.length

  if (!sparse) {
    const viaText = runStrategyA(extracted, template)
    if (viaText.ok && viaText.transactions.length >= STRATEGY_B_MIN_ROWS) {
      return viaText
    }
  }

  console.info('[universal-pdf] falling back to Strategy B (vision)')
  return runStrategyB(file, template.currencyDefault)
}

// ── Strategy A ────────────────────────────────────────────────────

function runStrategyA(
  extracted: PdfText,
  template: FormatTemplate,
): UniversalParseResult {
  const transactions: ParsedTransaction[] = []
  const warnings: string[] = []
  let skippedRows = 0

  // Haiku described semantic column names for PDFs; we find the column
  // index within each reconstructed row by matching header tokens.
  const colIdx = resolveColumnIndices(extracted, template)
  if (!colIdx) {
    return {
      ok: false,
      error: 'Could not locate column headers in PDF text',
      warnings,
    }
  }

  for (const page of extracted.pages) {
    for (const row of page.rows) {
      if (row.length < 2) {
        skippedRows++
        continue
      }
      const rawDate = colIdx.date != null ? row[colIdx.date] : undefined
      const rawDesc = colIdx.description != null ? row[colIdx.description] : undefined
      const rawAmount = colIdx.amount != null ? row[colIdx.amount] : undefined
      if (!rawDate || !rawDesc || !rawAmount) {
        skippedRows++
        continue
      }

      const date = parseDate(rawDate, template.dateFormat)
      if (!date) {
        skippedRows++
        continue
      }
      const amount = parseAmount(rawAmount, template.decimalFormat)
      if (amount === null || !Number.isFinite(amount) || amount === 0) {
        skippedRows++
        continue
      }

      transactions.push({
        date,
        description: rawDesc.trim() || '(no description)',
        amount,
        currency: template.currencyDefault,
        source: 'pdf_text',
        raw_description: rawDesc.trim(),
        balance: null,
      })
    }
  }

  if (transactions.length === 0) {
    return { ok: false, error: 'No transactions recognised in PDF text layer', warnings }
  }
  if (skippedRows > 0) warnings.push(`${skippedRows} PDF rows skipped.`)
  return { ok: true, transactions, template, skippedRows, warnings }
}

function resolveColumnIndices(
  extracted: PdfText,
  template: FormatTemplate,
): { date?: number; description?: number; amount?: number } | null {
  const targets = {
    date: template.columnMapping.date.toLowerCase(),
    description: template.columnMapping.description.toLowerCase(),
    amount: (template.columnMapping.amount ?? '').toLowerCase(),
  }

  for (const page of extracted.pages) {
    for (const row of page.rows) {
      const lower = row.map((c) => c.toLowerCase())
      const dateIdx = lower.findIndex((c) => c.includes(targets.date))
      const descIdx = lower.findIndex((c) => c.includes(targets.description))
      const amtIdx = targets.amount ? lower.findIndex((c) => c.includes(targets.amount)) : -1
      if (dateIdx !== -1 && descIdx !== -1) {
        return {
          date: dateIdx,
          description: descIdx,
          amount: amtIdx !== -1 ? amtIdx : undefined,
        }
      }
    }
  }
  return null
}

// ── Strategy B ────────────────────────────────────────────────────

async function runStrategyB(
  file: File,
  currencyDefault: string,
): Promise<UniversalParseResult> {
  const images = await renderPdfPagesToPng(file, STRATEGY_B_MAX_PAGES)
  if (images.length === 0) {
    return { ok: false, error: 'Could not render PDF pages for vision extraction' }
  }

  const res = await fetch('/api/extract-pdf-transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, currencyDefault }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `PDF vision extraction failed: ${detail || res.status}` }
  }
  const data = (await res.json()) as { transactions: ParsedTransaction[] }
  if (!Array.isArray(data.transactions) || data.transactions.length === 0) {
    return { ok: false, error: 'Vision extraction returned no transactions' }
  }
  return {
    ok: true,
    transactions: data.transactions,
    template: {
      headerHash: '',
      bankName: null,
      fileType: 'pdf',
      columnMapping: { date: 'date', description: 'description', amount: 'amount' },
      signConvention: 'signed_single_column',
      dateFormat: 'ISO',
      decimalFormat: 'dot',
      currencyDefault,
      sampleHeaders: '',
      detectionSource: 'llm',
    },
    skippedRows: 0,
    warnings: [],
  }
}

// ── pdfjs helpers ─────────────────────────────────────────────────

async function loadPdf(file: File) {
  const pdfjs = await import('pdfjs-dist')
  // Avoid the default worker URL (which requires build-time wiring)
  // by disabling the worker. pdfjs runs in-process; fine for our page
  // counts (≤ 3 pages for vision, ≤ ~30 for text).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(pdfjs as any).GlobalWorkerOptions.workerSrc = ''
  const buf = await file.arrayBuffer()
  // disableWorker isn't in the public type yet but is supported at
  // runtime — avoids bundling a worker URL in the client build.
  return pdfjs.getDocument({
    data: new Uint8Array(buf),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ disableWorker: true } as any),
  }).promise
}

async function extractPdfText(file: File, maxPages?: number): Promise<PdfText> {
  const pdf = await loadPdf(file)
  const lastPage = maxPages ? Math.min(maxPages, pdf.numPages) : pdf.numPages
  const pages: PdfText['pages'] = []
  let textChars = 0

  for (let pageNo = 1; pageNo <= lastPage; pageNo++) {
    const page = await pdf.getPage(pageNo)
    const content = await page.getTextContent()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = content.items as any[]

    // Cluster items by Y-bucket (transform[5] is the y translation).
    const buckets = new Map<number, { x: number; str: string }[]>()
    for (const it of items) {
      if (typeof it.str !== 'string' || it.str.trim() === '') continue
      const y = Math.round(it.transform[5] / ROW_Y_TOLERANCE) * ROW_Y_TOLERANCE
      const x = it.transform[4] as number
      const arr = buckets.get(y) ?? []
      arr.push({ x, str: it.str })
      buckets.set(y, arr)
    }

    const rows: string[][] = []
    const sortedY = Array.from(buckets.keys()).sort((a, b) => b - a) // top-to-bottom
    for (const y of sortedY) {
      const cells = (buckets.get(y) ?? []).sort((a, b) => a.x - b.x).map((c) => c.str.trim())
      // Merge adjacent cells that are actually one field split by pdfjs
      const merged: string[] = []
      for (const cell of cells) {
        if (!cell) continue
        if (merged.length > 0 && /^[^\d]/.test(cell) && /^[^\d]/.test(merged[merged.length - 1])) {
          merged[merged.length - 1] += ' ' + cell
        } else {
          merged.push(cell)
        }
      }
      if (merged.length > 0) rows.push(merged)
    }

    const text = rows.map((r) => r.join('  ')).join('\n')
    textChars += text.length
    pages.push({ text, rows })
  }

  return { pages, textChars }
}

async function renderPdfPagesToPng(file: File, maxPages: number): Promise<string[]> {
  const pdf = await loadPdf(file)
  const n = Math.min(maxPages, pdf.numPages)
  const out: string[] = []
  for (let pageNo = 1; pageNo <= n; pageNo++) {
    const page = await pdf.getPage(pageNo)
    const viewport = page.getViewport({ scale: 1.5 }) // balance legibility vs payload
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx as any, viewport, canvas } as any).promise
    out.push(canvas.toDataURL('image/png'))
  }
  return out
}
