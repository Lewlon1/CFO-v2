import type { HypothesisOutput } from './generator'

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'digit', pattern: /\d/ },
  { name: 'currency_symbol', pattern: /[£$€¥]/ },
  { name: 'greeting_welcome', pattern: /\bwelcome\b/i },
  { name: 'greeting_hi', pattern: /\bhi\b/i },
  { name: 'greeting_hello', pattern: /\bhello\b/i },
  { name: 'greeting_hey', pattern: /\bhey\b/i },
]

const DEFAULT_MERCHANTS = [
  'glovo',
  'deliveroo',
  'uber',
  'lyft',
  'starbucks',
  'amazon',
  'tesco',
  'sainsbury',
  'aldi',
  'lidl',
  'mercadona',
  'netflix',
  'spotify',
  'apple',
  'google',
  'paypal',
]

export interface ValidationResult {
  ok: boolean
  reason?: 'content_validation_failed'
  offenders?: string[]
}

/**
 * Deterministic content gate for a generated hypothesis. Blocks output that
 * leaks digits, currency symbols, greetings, merchant names, or 6-gram
 * duplication across lines. Caller falls through to no-hypothesis on fail.
 */
export function validateHypothesis(
  output: HypothesisOutput,
  opts?: { knownMerchants?: string[] },
): ValidationResult {
  const offenders: string[] = []
  const merchantPattern = buildMerchantPattern(opts?.knownMerchants)

  for (const [i, line] of output.lines.entries()) {
    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(line.text)) {
        offenders.push(`line ${i + 1} matched ${name}: "${line.text}"`)
      }
    }
    if (merchantPattern && merchantPattern.test(line.text)) {
      offenders.push(`line ${i + 1} mentions a merchant: "${line.text}"`)
    }
  }

  if (hasDuplicateContent(output.lines.map((l) => l.text))) {
    offenders.push('two or more lines share substantial content (6-gram overlap)')
  }

  if (offenders.length > 0) {
    return { ok: false, reason: 'content_validation_failed', offenders }
  }
  return { ok: true }
}

function buildMerchantPattern(extras: string[] = []): RegExp | null {
  const all = [...DEFAULT_MERCHANTS, ...extras.map((m) => m.toLowerCase())]
  if (all.length === 0) return null
  return new RegExp(`\\b(${all.map(escapeRegex).join('|')})\\b`, 'i')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasDuplicateContent(texts: string[]): boolean {
  const grams = texts.map(sixGrams)
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 1; j < grams.length; j++) {
      const setJ = new Set(grams[j])
      if (grams[i].some((g) => setJ.has(g))) return true
    }
  }
  return false
}

function sixGrams(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[—–.,;:!?"'()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const grams: string[] = []
  for (let i = 0; i + 6 <= tokens.length; i++) {
    grams.push(tokens.slice(i, i + 6).join(' '))
  }
  return grams
}
