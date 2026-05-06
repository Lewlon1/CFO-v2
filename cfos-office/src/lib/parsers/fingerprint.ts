// Header fingerprinting for the universal statement parser.
//
// Isomorphic — uses the Web Crypto API (crypto.subtle), which is present
// in browsers, Web Workers, Edge Runtime, and Node 20+. Do NOT reach for
// Node's 'crypto' module here or this file becomes server-only.
//
// Normalisation before hashing:
//   1. lowercase each header
//   2. trim whitespace
//   3. drop empty strings
//   4. sort alphabetically
//
// Sorting makes the hash stable across column reorderings between bank
// export versions (Revolut occasionally shuffles columns between releases).

export async function computeHeaderHash(headerRow: string[]): Promise<string> {
  const normalised = headerRow
    .map((h) => h.toLowerCase().trim())
    .filter(Boolean)
    .sort()
    .join('|')

  const data = new TextEncoder().encode(normalised)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Extract the first N rows of a CSV verbatim as the detection sample.
// This is the only CSV content permitted to leave the browser for
// format detection (see /api/detect-format).
export function extractCsvSample(csvText: string, maxRows = 5): string {
  return csvText.split(/\r?\n/).slice(0, maxRows).join('\n')
}
