const TRANSACTION_PREFIXES =
  /^(card payment to|direct debit to|payment to|pos|dd|sto|fpo|bgc)\s+/i

// Payment platform prefixes (SQ *, AMZN*, PP*, CRV*, etc.)
const PLATFORM_PREFIXES = /^(sq\s*\*|amzn\s*\*|pp\s*\*|crv\s*\*|tst\s*\*|goo\s*\*)/i

const LEGAL_SUFFIXES =
  /\b(ltd|limited|inc|incorporated|plc|s\.?l\.?|s\.?a\.?|gmbh|ag|co\.?|corp|pty|llc|llp|bv|nv)\b\.?\s*$/i

const REFERENCE_NUMBERS = /[\s]*[*#x]\d{2,}$|\s+\d{4,}$/i

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
}

export function normaliseMerchant(raw: string): string {
  if (!raw) return ''
  let text = raw.trim().toLowerCase()
  text = text.replace(TRANSACTION_PREFIXES, '')
  text = text.replace(PLATFORM_PREFIXES, '')
  text = text.replace(LEGAL_SUFFIXES, '')
  text = text.replace(REFERENCE_NUMBERS, '')
  text = text.replace(NON_WORD, '')
  text = text.replace(MULTI_SPACE, ' ').trim()
  const normalised = text || raw.trim().toLowerCase()

  // Check aliases
  return MERCHANT_ALIASES[normalised] ?? normalised
}

/** Alias for normaliseMerchant — used as match_value in value_category_rules */
export const getMerchantKey = normaliseMerchant
