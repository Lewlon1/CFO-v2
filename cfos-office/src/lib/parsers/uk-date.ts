/**
 * Parse a UK-format date string (DD/MM/YYYY or DD-MM-YYYY) into ISO 8601.
 * Returns empty string if the input can't be parsed.
 */
export function parseUKDate(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()

  // DD/MM/YYYY or DD-MM-YYYY
  const match = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (match) {
    const [, day, month, year] = match
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`
  }

  // ISO format passthrough (YYYY-MM-DD)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00Z`
  }

  return ''
}
