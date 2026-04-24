// Flatten an XLSX workbook to CSV text suitable for the universal
// parser. Bank XLSX exports frequently prefix the sheet with metadata
// (account number, holder, report-generation date, etc.) before the
// actual transaction table — so we detect the real header row via a
// heuristic and slice from there.
//
// Heuristic: the header row is the first row where every non-empty
// cell is a short plain-text token (≤ 40 chars, not a date, not an
// amount) AND the row has at least 3 non-empty cells. Rows above it
// (metadata, titles, account labels) are dropped.

import * as XLSX from 'xlsx'

const DATE_LIKE = /\d{1,4}[-/]\d{1,2}[-/]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}/
const AMOUNT_LIKE = /^[\s€$£¥]*-?[\d.,−]+[\s€$£¥]*$/

function looksLikeHeaderCell(v: unknown): boolean {
  if (v === null || v === undefined) return false
  const s = String(v).trim()
  if (!s) return false
  if (s.length > 40) return false
  if (DATE_LIKE.test(s)) return false
  if (AMOUNT_LIKE.test(s)) return false
  // Header cells are typically word-like: contain a letter, no newlines.
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false
  if (/\n/.test(s)) return false
  return true
}

function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < rows.length && i < 30; i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '')
    if (nonEmpty.length < 3) continue
    if (nonEmpty.every(looksLikeHeaderCell)) return i
  }
  return 0 // fall back: assume row 0 is the header
}

// Dedup column names (Santander exports two "Currency" columns; BBVA
// likewise). Papa.parse otherwise overwrites a key on duplicate.
function dedupHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((h) => {
    const key = h || '_'
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return n === 1 ? key : `${key}_${n}`
  })
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function xlsxBufferToCSV(buffer: ArrayBuffer | Buffer): string {
  const workbook =
    buffer instanceof ArrayBuffer
      ? XLSX.read(buffer, { type: 'array' })
      : XLSX.read(buffer, { type: 'buffer' })

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return ''

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: false, // emit formatted strings so dates come out like "24/04/2026"
  })
  if (rows.length === 0) return ''

  const headerIdx = findHeaderRowIndex(rows)
  const headerRow = rows[headerIdx] ?? []
  // Array.from fills sparse-array holes with undefined; .map would
  // skip them and leave holes, which break the "is this cell empty?"
  // check downstream.
  const rawHeaders = Array.from(headerRow, (c) =>
    c === null || c === undefined ? '' : String(c).trim(),
  )

  // Find the span of non-empty header columns. Spanish XLSX exports
  // often carry a null first column (merged-cell artefact) and trailing
  // null columns. Trimming both ends prevents Haiku from being offered
  // a spurious empty-string header that it might choose as a column.
  let startCol = 0
  while (startCol < rawHeaders.length && rawHeaders[startCol] === '') startCol++
  let endCol = rawHeaders.length
  while (endCol > startCol && rawHeaders[endCol - 1] === '') endCol--
  if (startCol >= endCol) return ''

  const headers = dedupHeaders(rawHeaders.slice(startCol, endCol))
  const dataRows = rows.slice(headerIdx + 1)

  const lines: string[] = []
  lines.push(headers.map(csvEscape).join(','))
  for (const row of dataRows) {
    if (!Array.isArray(row)) continue
    const slice: unknown[] = []
    for (let i = startCol; i < endCol; i++) {
      const v = row[i]
      slice.push(v === undefined ? null : v) // normalise sparse holes
    }
    if (slice.every((c) => c === null || c === undefined || String(c).trim() === '')) continue
    lines.push(slice.map(csvEscape).join(','))
  }
  return lines.join('\n')
}
