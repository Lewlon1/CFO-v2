// Universal PDF parser — client-side orchestrator that renders pages
// to PNG and POSTs them to /api/extract-pdf-transactions for Haiku
// vision extraction. This is the only PDF path — there is no text-layer
// fallback; column alignment against a Haiku-described layout produced
// garbage amounts (see SESSION-LOG.md) and is deleted.
//
// Privacy note: PDF pages rendered as images DO leave the browser (EU
// Bedrock via /api/extract-pdf-transactions). CSV text-layer privacy
// (sample-only leaves browser) does not apply to PDFs — the whole
// rendered page surface is submitted for extraction.
//
// Sign convention: the server endpoint returns ParsedTransaction with
// debits negative, credits positive. We pass through without mutation.
//
// Dependencies: pdfjs-dist for rendering. The worker is disabled and
// pdfjs runs in-process (fine for our ≤10 page payloads).

import type { ParsedTransaction, UniversalParseResult } from './types'

const DEFAULT_MAX_PAGES = 10

// Response from /api/extract-pdf-transactions. Kept private to this
// module; callers see UniversalParseResult.
type ExtractResponse = {
  transactions: ParsedTransaction[]
  metadata?: {
    openingBalance: number | null
    closingBalance: number | null
    statementPeriodStart: string | null
    statementPeriodEnd: string | null
    accountCurrency: string | null
  }
  warnings?: string[]
}

export async function parseUniversalPDF(
  file: File,
  currencyDefault: string,
  maxPages: number = DEFAULT_MAX_PAGES,
): Promise<UniversalParseResult> {
  const images = await renderPdfPagesToPng(file, maxPages)
  if (images.length === 0) {
    return { ok: false, error: 'Could not render PDF pages for vision extraction' }
  }

  let res: Response
  try {
    res = await fetch('/api/extract-pdf-transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, currencyDefault }),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `PDF vision extraction request failed: ${detail}` }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `PDF vision extraction failed: ${detail || res.status}` }
  }

  const data = (await res.json()) as ExtractResponse
  if (!Array.isArray(data.transactions) || data.transactions.length === 0) {
    return {
      ok: false,
      error: 'Vision extraction returned no transactions',
      warnings: data.warnings,
    }
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
      currencyDefault: data.metadata?.accountCurrency ?? currencyDefault,
      sampleHeaders: '',
      detectionSource: 'llm',
    },
    skippedRows: 0,
    warnings: data.warnings ?? [],
    statementMetadata: data.metadata ?? null,
  }
}

// ── pdfjs rendering ───────────────────────────────────────────────

// pdfjs-dist v5 validates GlobalWorkerOptions.workerSrc as a URL even
// when disableWorker is passed. Wire up a worker URL via import.meta.url
// so the browser bundle carries the worker file. Safe to call many
// times — we only assign once.
let workerConfigured = false
async function ensureWorkerConfigured() {
  if (workerConfigured) return
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(pdfjs as any).GlobalWorkerOptions.workerSrc = workerUrl
  workerConfigured = true
}

async function loadPdf(file: File) {
  await ensureWorkerConfigured()
  const pdfjs = await import('pdfjs-dist')
  const buf = await file.arrayBuffer()
  return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
}

async function renderPdfPagesToPng(file: File, maxPages: number): Promise<string[]> {
  const pdf = await loadPdf(file)
  const n = Math.min(maxPages, pdf.numPages)
  const out: string[] = []
  for (let pageNo = 1; pageNo <= n; pageNo++) {
    const page = await pdf.getPage(pageNo)
    const viewport = page.getViewport({ scale: 1.5 })
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
