// Client-side orchestrator for the universal statement parser.
//
// Flow for a single file the user just selected:
//
//   1. Identify file type from extension.
//   2. CSV / XLSX: short-circuit if it looks like a holdings export
//      (Vanguard etc.) and hand back to the server-side holdings
//      pipeline. XLSX is flattened in-browser to CSV text first.
//   3. CSV / XLSX: compute a header hash + sample, POST to
//      /api/detect-format for a cached FormatTemplate, then parse the
//      full text client-side via parseUniversalCSV.
//   4. PDF: render pages to PNG in-browser, POST to
//      /api/extract-pdf-transactions for Haiku vision extraction.
//      PDF pages DO leave the browser — different privacy posture than
//      CSV, but unavoidable for image extraction.
//   5. OFX / QIF: deterministic parse, no detection needed.
//
// Output is a ParsedTransaction[] the caller POSTs to /api/upload
// with { action: 'preview', transactions }.

import Papa from 'papaparse'
import { computeHeaderHash, extractCsvSample } from './fingerprint'
import { detectHoldingsMapping } from './holdings-detector'
import { parseOFX } from './ofx'
import { parseQIF } from './qif'
import { parseUniversalCSV, repairTemplate } from './universal-csv'
import { parseUniversalPDF } from './universal-pdf'
import { xlsxBufferToCSV } from './xlsx-to-csv'
import type {
  FileType,
  FormatTemplate,
  ParsedTransaction,
  UniversalParseResult,
} from './types'

export type ClientParseOutcome =
  | {
      kind: 'transactions'
      transactions: ParsedTransaction[]
      template?: FormatTemplate
      warnings: string[]
    }
  | { kind: 'holdings_hint' } // caller should FormData-POST the file as before
  | { kind: 'server_fallback'; reason: string } // images only (screenshots)
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

  // Images still go through the server screenshot path.
  if (fileType === 'image') {
    return { kind: 'server_fallback', reason: 'image' }
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
      return handleTabular(text, file.name, 'csv')
    }

    if (fileType === 'xlsx') {
      // Flatten the workbook to CSV text with header-row detection so
      // bank exports with metadata prefix rows (Santander, BBVA) land
      // in the same template path as regular CSV uploads.
      const buf = await file.arrayBuffer()
      let csv: string
      try {
        csv = xlsxBufferToCSV(buf)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        return { kind: 'error', error: `Could not read XLSX: ${detail}` }
      }
      if (!csv || csv.trim().length === 0) {
        return { kind: 'error', error: 'XLSX first sheet is empty' }
      }
      return handleTabular(csv, file.name, 'xlsx')
    }

    if (fileType === 'pdf') {
      // Currency default is best-effort here; the vision endpoint
      // prefers whatever `accountCurrency` it reads from the statement.
      const result = await parseUniversalPDF(file, 'GBP')
      return outcomeFromResult(result)
    }

    return { kind: 'error', error: 'Unhandled file type' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'error', error: message }
  }
}

// Shared CSV/XLSX handling. Input is CSV text either read directly
// (.csv) or flattened from a workbook (.xlsx → sheet_to_csv).
async function handleTabular(
  text: string,
  filename: string,
  fileType: 'csv' | 'xlsx',
): Promise<ClientParseOutcome> {
  const preview = Papa.parse<Record<string, string>>(text, { header: true, preview: 1 })
  const headers = preview.meta.fields ?? []

  // Holdings shortcut — strict detector, won't swallow transaction files.
  if (headers.length > 0 && detectHoldingsMapping(headers)) {
    return { kind: 'holdings_hint' }
  }
  if (headers.length === 0) {
    return { kind: 'error', error: 'No headers detected in file' }
  }

  const headerHash = await computeHeaderHash(headers)
  const sample = extractCsvSample(text, 5)
  // XLSX files go through the CSV template on the server (they're just
  // tabular data once flattened). The template cache is still keyed on
  // header hash so repeat uploads of the same sheet layout are free.
  const rawTemplate = await fetchTemplate({
    fileType: 'csv',
    headerHash,
    sample,
    filename,
  })
  // Haiku sometimes picks a narrative column (e.g. BBVA's "Movement")
  // as amountCol. repairTemplate cross-checks against the data rows
  // and swaps in the first numeric column if needed.
  const template = repairTemplate(text, rawTemplate)
  const result = parseUniversalCSV(text, template)
  return outcomeFromResult(result)
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
