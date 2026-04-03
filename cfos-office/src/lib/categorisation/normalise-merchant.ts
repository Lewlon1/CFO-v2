const TRANSACTION_PREFIXES =
  /^(card payment to|direct debit to|payment to|pos|dd|sto|fpo|bgc)\s+/i

const LEGAL_SUFFIXES =
  /\b(ltd|limited|inc|incorporated|plc|s\.?l\.?|s\.?a\.?|gmbh|ag|co\.?|corp|pty|llc|llp|bv|nv)\b\.?\s*$/i

const REFERENCE_NUMBERS = /[\s]*[*#x]\d{2,}$|\s+\d{4,}$/i

const NON_WORD = /[^\p{L}\p{N}\s\-&.]/gu

const MULTI_SPACE = /\s{2,}/g

export function normaliseMerchant(raw: string): string {
  if (!raw) return ''
  let text = raw.trim().toLowerCase()
  text = text.replace(TRANSACTION_PREFIXES, '')
  text = text.replace(LEGAL_SUFFIXES, '')
  text = text.replace(REFERENCE_NUMBERS, '')
  text = text.replace(NON_WORD, '')
  text = text.replace(MULTI_SPACE, ' ').trim()
  return text || raw.trim().toLowerCase()
}
