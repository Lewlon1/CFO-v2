import Papa from 'papaparse'
import { isRevolutCSV } from './revolut'
import { isSantanderFile } from './santander'
import { isMonzoCSV } from './monzo'
import { isStarlingCSV } from './starling'
import { isHsbcCSV } from './hsbc'
import { isBarclaysCSV } from './barclays'
import type { ParsedTransactionSource } from './types'

export type DetectedFormat =
  | 'revolut'
  | 'santander'
  | 'monzo'
  | 'starling'
  | 'hsbc'
  | 'barclays'
  | 'generic'
  | 'screenshot'
  | 'pdf'
  | 'unknown'

export function detectFormat(filename: string, fileText?: string): DetectedFormat {
  const lower = filename.toLowerCase()

  // PDF files
  if (/\.pdf$/.test(lower)) return 'pdf'

  // Image files
  if (/\.(png|jpg|jpeg|heic|webp)$/.test(lower)) return 'screenshot'

  // XLSX — route to Santander parser
  if (isSantanderFile(filename)) return 'santander'

  // CSV — check headers
  if (fileText && /\.csv$/i.test(lower)) {
    const preview = Papa.parse<Record<string, string>>(fileText, {
      header: true,
      preview: 5,
    })
    const headers = preview.meta.fields ?? []

    if (isRevolutCSV(headers)) return 'revolut'
    if (isMonzoCSV(headers)) return 'monzo'
    if (isStarlingCSV(headers)) return 'starling'
    if (isBarclaysCSV(headers)) return 'barclays'

    // HSBC needs first rows for headerless detection
    const noHeaderPreview = Papa.parse<string[]>(fileText, {
      header: false,
      preview: 3,
    })
    if (isHsbcCSV(headers, noHeaderPreview.data)) return 'hsbc'

    return 'generic'
  }

  return 'unknown'
}

export function sourceFromFormat(format: DetectedFormat): ParsedTransactionSource {
  switch (format) {
    case 'revolut': return 'csv_revolut'
    case 'santander': return 'csv_santander'
    case 'monzo': return 'csv_monzo'
    case 'starling': return 'csv_starling'
    case 'hsbc': return 'csv_hsbc'
    case 'barclays': return 'csv_barclays'
    case 'screenshot': return 'screenshot'
    case 'pdf': return 'pdf_statement'
    default: return 'csv_generic'
  }
}
