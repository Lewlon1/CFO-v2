/**
 * Generates a deterministic external_id for a transaction using SHA-256.
 * This is used for deduplication during CSV import.
 */
export async function generateExternalId(
  date: string,
  amount: string,
  description: string,
  rowIndex?: number
): Promise<string> {
  const rowSuffix = rowIndex !== undefined ? `|row:${rowIndex}` : ""
  const raw = `${date}|${amount}|${description}${rowSuffix}`.toLowerCase().trim()
  const encoded = new TextEncoder().encode(raw)
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)
}
