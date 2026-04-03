const TRANSACTION_PREFIXES =
  /^(card payment to|direct debit to|payment to|pos|dd|sto|fpo|bgc)\s+/i

const LEGAL_SUFFIXES =
  /\b(ltd|limited|inc|incorporated|plc|s\.?l\.?|s\.?a\.?|gmbh|ag|co\.?|corp|pty|llc|llp|bv|nv)\b\.?\s*$/i

const REFERENCE_NUMBERS = /[\s]*[*#x]\d{2,}$|\s+\d{4,}$/i

const NON_WORD = /[^\p{L}\p{N}\s\-&.]/gu

const MULTI_SPACE = /\s{2,}/g

/**
 * Normalises a merchant name for consistent pattern matching.
 * Strips transaction prefixes, legal suffixes, reference numbers,
 * and non-alphanumeric noise. Unicode-safe.
 */
export function normaliseMerchant(raw: string): string {
  if (!raw) return ""

  let text = raw.trim().toLowerCase()

  // Strip transaction prefixes
  text = text.replace(TRANSACTION_PREFIXES, "")

  // Strip legal suffixes (end of string only)
  text = text.replace(LEGAL_SUFFIXES, "")

  // Strip card/reference numbers
  text = text.replace(REFERENCE_NUMBERS, "")

  // Strip non-word characters (keep letters, numbers, spaces, hyphens, &, dots)
  text = text.replace(NON_WORD, "")

  // Collapse whitespace
  text = text.replace(MULTI_SPACE, " ").trim()

  // Fallback: if normalisation wiped everything, use original lowercase
  return text || raw.trim().toLowerCase()
}
