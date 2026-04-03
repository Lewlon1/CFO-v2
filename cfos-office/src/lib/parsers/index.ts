import Papa from 'papaparse'
import { isRevolutCSV } from './revolut'
import { isSantanderFile } from './santander'
import type { ParsedTransactionSource } from './types'

export type DetectedFormat =
  | 'revolut'
  | 'santander'
  | 'generic'
  | 'screenshot'
  | 'unknown'

export function detectFormat(filename: string, fileText?: string): DetectedFormat {
  const lower = filename.toLowerCase()

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
    return 'generic'
  }

  return 'unknown'
}

export function sourceFromFormat(format: DetectedFormat): ParsedTransactionSource {
  switch (format) {
    case 'revolut': return 'csv_revolut'
    case 'santander': return 'csv_santander'
    case 'screenshot': return 'screenshot'
    default: return 'csv_generic'
  }
}
