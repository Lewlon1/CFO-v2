const TRANSACTION_PREFIXES =
  /^(card payment to|direct debit to|payment to|pos|dd|sto|fpo|bgc|contactless|card purchase)\s+/i

// Payment platform prefixes (SQ *, AMZN*, PP*, CRV*, etc.)
const PLATFORM_PREFIXES = /^(sq\s*\*|amzn\s*\*|pp\s*\*|crv\s*\*|tst\s*\*|goo\s*\*)/i

// UK bank payment-type suffixes — "HYPEROPTIC DD (Direct Debit) Reference: 1HYP0009..."
// Applied BEFORE lowercasing/other strips. Case-insensitive.
const BANK_SUFFIX_PATTERNS: RegExp[] = [
  /\s*\(direct debit\)\s*reference\s*:?.*$/i,
  /\s*\(faster payments?\)\s*reference\s*:?.*$/i,
  /\s*\(standing order\)\s*reference\s*:?.*$/i,
  /\s*\(bill payment\)\s*reference\s*:?.*$/i,
  /\s*\(p2p payment\)\s*/i,
  /\s*\(card payment\)\s*/i,
]

// Non-Sterling Transaction Fee (Merchant Name) → Merchant Name
const NON_STERLING_FEE = /^non-sterling transaction fee\s*\((.+?)\)\s*.*$/i

const LEGAL_SUFFIXES =
  /\b(ltd|limited|inc|incorporated|plc|s\.?l\.?|s\.?a\.?|gmbh|ag|co\.?|corp|pty|llc|llp|bv|nv)\b\.?\s*$/i

const REFERENCE_NUMBERS = /[\s]*[*#x]\d{2,}$|\s+\d{4,}$/i

// Trailing " dd" token (payment-type marker left after prefix strip fails)
const TRAILING_DD = /\s+dd$/i

// Trailing location suffixes. Conservative — must be EITHER:
//   - preceded by a comma ("Merchant, LONDON" / "Merchant, LONDON GB")
//   - uppercase city followed by 2-letter country code ("MERCHANT MADRID GB")
// Otherwise we risk eating trailing words that are part of the merchant name
// (e.g. "ROBYN WELCH" where WELCH would look like a location).
const TRAILING_LOCATION_COMMA = /,\s+[A-Z][A-Z\s]{2,}(\s+[A-Z]{2})?\s*$/
const TRAILING_LOCATION_CITY_COUNTRY = /\s+[A-Z]{3,}\s+[A-Z]{2}\s*$/

const NON_WORD = /[^\p{L}\p{N}\s\-&.]/gu

const MULTI_SPACE = /\s{2,}/g

// Known merchant aliases — normalised form -> canonical key
const MERCHANT_ALIASES: Record<string, string> = {
  'amazon prime': 'amazon',
  'amzn': 'amazon',
  'amazon.co.uk': 'amazon',
  'amazon.es': 'amazon',
  'uber eats': 'uber_eats',
  'ubr eats': 'uber_eats',
  'deliveroo.com': 'deliveroo',
  'just-eat': 'just eat',
  'justeat': 'just eat',
  'hyperoptic dd': 'hyperoptic',
  'zurich assurance': 'zurich',
  'manchester c c': 'manchester city council',
}

export function normaliseMerchant(raw: string): string {
  if (!raw) return ''
  let text = raw.trim()

  // Unwrap Non-Sterling Transaction Fee wrapper while we still have the original case
  text = text.replace(NON_STERLING_FEE, '$1')

  // Strip UK bank payment-type suffixes before lowercasing
  for (const pattern of BANK_SUFFIX_PATTERNS) {
    text = text.replace(pattern, '')
  }

  // Strip trailing location suffix (uppercase-only heuristic)
  text = text.replace(TRAILING_LOCATION_COMMA, '')
  text = text.replace(TRAILING_LOCATION_CITY_COUNTRY, '')

  text = text.toLowerCase()
  text = text.replace(TRANSACTION_PREFIXES, '')
  text = text.replace(PLATFORM_PREFIXES, '')
  text = text.replace(LEGAL_SUFFIXES, '')
  text = text.replace(REFERENCE_NUMBERS, '')
  text = text.replace(TRAILING_DD, '')
  text = text.replace(NON_WORD, '')
  text = text.replace(MULTI_SPACE, ' ').trim()
  const normalised = text || raw.trim().toLowerCase()

  // Check aliases
  return MERCHANT_ALIASES[normalised] ?? normalised
}

/** Alias for normaliseMerchant — used as match_value in value_category_rules */
export const getMerchantKey = normaliseMerchant
