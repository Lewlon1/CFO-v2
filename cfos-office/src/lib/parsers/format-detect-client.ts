// Client-side orchestrator for the universal statement parser.
//
// Flow for a single file the user just selected:
//
//   1. Identify file type from extension.
//   2. CSV only: short-circuit if the CSV looks like a holdings export
//      (Vanguard etc.) — return a HoldingsHint so the caller can
//      FormData-POST it to the existing holdings pipeline.
//   3. For CSV/PDF: read a sample, compute a header hash, POST to
//      /api/detect-format to get (or create+cache) a FormatTemplate.
//   4. Parse the full file client-side using the template. The raw
//      file never leaves the browser.
//   5. For OFX/QIF: no detection needed — structured formats parse
//      directly client-side.
//
// Output is a ParsedTransaction[] that the caller hands to
// /api/upload with { action: 'preview', transactions }.

import Papa from 'papaparse'
import { computeHeaderHash, extractCsvSample } from './fingerprint'
import { detectHoldingsMapping } from './holdings-detector'
import { parseOFX } from './ofx'
import { parseQIF } from './qif'
import { parseUniversalCSV } from './universal-csv'
import { extractPdfSample, parseUniversalPDF } from './universal-pdf'
import type {
  FileType,
  FormatTemplate,
  ParsedTransaction,
  UniversalParseResult,
} from './types'

export type ClientParseOutcome =
  | { kind: 'transactions'; transactions: ParsedTransaction[]; template?: FormatTemplate; warnings: string[] }
  | { kind: 'holdings_hint' } // caller should FormData-POST the file as before
  | { kind: 'server_fallback'; reason: string } // e.g. XLSX/image — use server path
  | { kind: 'error'; error: string }

export function fileTypeFromName(filename: string): FileType | 'unsupported' {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv') return 'csv'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'ofx') return 'ofx'
  if (ext === 'qif') return 'qif'
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (['png', 'jpg', 'jpeg', 'heic', 'webp'].includes(ext)) return 'image'
  return 'unsupported'
}

export async function parseFileOnClient(file: File): Promise<ClientParseOutcome> {
  const fileType = fileTypeFromName(file.name)
  if (fileType === 'unsupported') {
    return { kind: 'error', error: `Unsupported file type: ${file.name}` }
  }

  // XLSX and images stay on the server path — out of universal-parser scope.
  if (fileType === 'xlsx' || fileType === 'image') {
    return { kind: 'server_fallback', reason: fileType }
  }

  try {
    if (fileType === 'ofx') {
      const text = await file.text()
      const r = parseOFX(text)
      if (!r.ok) return { kind: 'error', error: r.error }
      return { kind: 'transactions', transactions: r.transactions, warnings: [] }
    }

    if (fileType === 'qif') {
      const text = await file.text()
      const r = parseQIF(text)
      if (!r.ok) return { kind: 'error', error: r.error }
      return { kind: 'transactions', transactions: r.transactions, warnings: [] }
    }

    if (fileType === 'csv') {
      const text = await file.text()

      // Inspect headers once. If it's a holdings CSV, hand back to the
      // existing server-side holdings pipeline so that path is
      // unchanged. detectHoldingsMapping is already strict about
      // rejecting transaction-shaped files, so this doesn't steal
      // normal uploads.
      const preview = Papa.parse<Record<string, string>>(text, { header: true, preview: 1 })
      const headers = preview.meta.fields ?? []
      if (headers.length > 0 && detectHoldingsMapping(headers)) {
        return { kind: 'holdings_hint' }
      }
      if (headers.length === 0) {
        return { kind: 'error', error: 'CSV has no headers.' }
      }

      const headerHash = await computeHeaderHash(headers)
      const sample = extractCsvSample(text, 5)
      const template = await fetchTemplate({ fileType: 'csv', headerHash, sample, filename: file.name })
      const result = parseUniversalCSV(text, template)
      return outcomeFromResult(result)
    }

    if (fileType === 'pdf') {
      const sample = await extractPdfSample(file)
      // PDFs don't have a stable column-header row; hash the first
      // page's normalised text as a stable proxy for "this bank's PDF
      // layout" so repeat uploads hit the cache.
      const headerHash = await computeHeaderHash(sample.split(/\s+/).slice(0, 30))
      const template = await fetchTemplate({ fileType: 'pdf', headerHash, sample, filename: file.name })
      const result = await parseUniversalPDF(file, template)
      return outcomeFromResult(result)
    }

    return { kind: 'error', error: 'Unhandled file type' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'error', error: message }
  }
}

async function fetchTemplate(input: {
  fileType: FileType
  headerHash: string
  sample: string
  filename: string
}): Promise<FormatTemplate> {
  const res = await fetch('/api/detect-format', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Format detection failed: ${detail || res.status}`)
  }
  const data = (await res.json()) as { template: FormatTemplate }
  return data.template
}

function outcomeFromResult(r: UniversalParseResult): ClientParseOutcome {
  if (!r.ok) return { kind: 'error', error: r.error }
  return {
    kind: 'transactions',
    transactions: r.transactions,
    template: r.template,
    warnings: r.warnings,
  }
}
