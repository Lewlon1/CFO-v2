// Claim-grounded validator. Replaces the v2 `assertNoFabricatedNumbers`
// regex check with a typed extractor that walks each authored field, pulls
// out tokens that could be numeric or merchant claims, and checks each
// against the Evidence's `verifiable_claims` allowlist.
//
// Tokens we extract:
//   - currency amounts: €485.58, £301, $4,000, 25,60€
//   - integers: 14, 90, 7
//   - percentages: 22%, 22 percent
//   - dates: yyyy-mm-dd, "24 Jan", "Jan 24"
//   - merchant words: TitleCase / UPPERCASE multi-word tokens (heuristic)
//
// Pass rules:
//   - exact match against any claim's `value` or `alt_forms`
//   - small contextual integers (<=7) are allowed unmatched (days/weeks)
//   - merchants must match a claim of kind 'merchant' or appear in the
//     evidence's brief/headline
//   - any unmatched token rejects the field

import type { AuthoredWowMoment, Evidence } from './types'

const SMALL_INTEGER_FREE_PASS = 7

export interface ValidationResult {
  ok: boolean
  // List of unmatched tokens that caused rejection. Empty when ok=true.
  unmatched: { field: keyof AuthoredFields; token: string; kind: string }[]
}

export interface AuthoredFields {
  observed: string
  named: string
  asked: string
  proposed: string
}

// Tokens we extract from each field. Each one must match an allowed claim or
// the field is rejected.
interface ExtractedToken {
  kind: 'amount' | 'percent' | 'integer' | 'date' | 'merchant'
  raw: string         // the literal text as it appears in the field
  numeric?: number    // for numeric kinds, parsed value
}

const CURRENCY_AMOUNT = /(?:[€£$])\s?\d[\d.,]*|\d[\d.,]*\s?(?:[€£$])/g
const PERCENT = /\b\d{1,3}\s?%/g
const INTEGER = /\b\d+\b/g
const DATE_NUMERIC = /\b\d{4}-\d{2}-\d{2}\b/g
const DATE_SHORT_MONTH = /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:[a-z]+)?\b/gi
// TitleCase or UPPERCASE multi-word run, treated as a candidate merchant
// reference. Matches "Iberia", "Aldi", "Milwaukee", "Compra Revolut".
const MERCHANT_CANDIDATE = /\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+){0,3}\b/g

// Base stopwords — extended per-call by the caller (e.g. with the user's
// first name) so any author addressing a user as "Sarah, here's…" doesn't
// trigger a false-positive merchant check.
const BASE_STOPWORDS = new Set([
  'CFO', 'You', 'Your', 'The', 'For', 'On', 'In', 'Of', 'At', 'And', 'But', 'Or',
  'Foundation', 'Burden', 'Investment', 'Leak', 'Aligned',
  'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  'January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
])

export interface ValidatorContext {
  // First name is auto-injected as a stopword so "Sarah," doesn't get
  // flagged as a merchant claim.
  firstName?: string
  // Caller-supplied additions (e.g. archetype name, currency words).
  extraStopwords?: string[]
}

export function extractTokens(text: string, stopwords: Set<string> = BASE_STOPWORDS): ExtractedToken[] {
  if (!text) return []
  const tokens: ExtractedToken[] = []

  // Currency amounts first so the integer pass below doesn't double-count
  // the digits inside e.g. "€485.58".
  const consumed = new Set<string>()
  for (const match of text.matchAll(CURRENCY_AMOUNT)) {
    tokens.push({ kind: 'amount', raw: match[0].trim(), numeric: parseAmount(match[0]) })
    consumed.add(match[0])
  }
  // Strip already-consumed substrings so subsequent extractors don't double-count.
  let stripped = text
  for (const c of consumed) stripped = stripped.split(c).join(' ')

  for (const match of stripped.matchAll(PERCENT)) {
    const n = parseInt(match[0], 10)
    if (!Number.isNaN(n)) tokens.push({ kind: 'percent', raw: match[0].trim(), numeric: n })
  }

  // Strip percents before integer pass.
  for (const match of stripped.matchAll(PERCENT)) {
    stripped = stripped.split(match[0]).join(' ')
  }

  for (const match of stripped.matchAll(DATE_NUMERIC)) {
    tokens.push({ kind: 'date', raw: match[0] })
    stripped = stripped.split(match[0]).join(' ')
  }
  for (const match of stripped.matchAll(DATE_SHORT_MONTH)) {
    tokens.push({ kind: 'date', raw: match[0] })
    stripped = stripped.split(match[0]).join(' ')
  }

  for (const match of stripped.matchAll(INTEGER)) {
    const n = parseInt(match[0], 10)
    if (!Number.isNaN(n)) tokens.push({ kind: 'integer', raw: match[0], numeric: n })
  }

  for (const match of stripped.matchAll(MERCHANT_CANDIDATE)) {
    const phrase = match[0].trim()
    // Skip pure stopwords / small words.
    const head = phrase.split(/\s+/)[0]
    if (stopwords.has(head)) continue
    if (phrase.length <= 3) continue
    tokens.push({ kind: 'merchant', raw: phrase })
  }

  return tokens
}

// Build a per-call stopword set: BASE_STOPWORDS ∪ {firstName, extras}.
function buildStopwords(ctx?: ValidatorContext): Set<string> {
  if (!ctx?.firstName && !ctx?.extraStopwords?.length) return BASE_STOPWORDS
  const out = new Set(BASE_STOPWORDS)
  if (ctx.firstName) out.add(ctx.firstName)
  if (ctx.extraStopwords) for (const w of ctx.extraStopwords) out.add(w)
  return out
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[€£$\s]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '')
  const n = parseFloat(cleaned)
  return Number.isNaN(n) ? 0 : n
}

// Build the allowed-token index from an Evidence record. Every value and
// alt_form joins a single set of strings the validator checks against.
export function buildAllowedSet(evidence: Evidence): Set<string> {
  const allowed = new Set<string>()
  for (const claim of evidence.verifiable_claims) {
    allowed.add(String(claim.value).trim())
    allowed.add(String(claim.value).toLowerCase().trim())
    for (const alt of claim.alt_forms) {
      allowed.add(alt.trim())
      allowed.add(alt.toLowerCase().trim())
    }
  }
  // Merchant words inside the evidence's headline or brief are also fair
  // game — Opus is given those as the prompt and should be able to echo
  // them. We add TitleCase tokens from the brief.
  for (const text of [evidence.headline, evidence.brief]) {
    for (const match of text.matchAll(MERCHANT_CANDIDATE)) {
      allowed.add(match[0].trim())
      allowed.add(match[0].toLowerCase().trim())
    }
  }
  return allowed
}

export function validateClaims(
  fields: AuthoredFields,
  evidence: Evidence,
  ctx?: ValidatorContext,
): ValidationResult {
  const allowed = buildAllowedSet(evidence)
  const stopwords = buildStopwords(ctx)
  const unmatched: ValidationResult['unmatched'] = []

  for (const [name, text] of Object.entries(fields) as [keyof AuthoredFields, string][]) {
    const tokens = extractTokens(text, stopwords)
    for (const tok of tokens) {
      // Allow small contextual integers (1–7) without grounding (days, weeks,
      // a single charge "twice/three times" rendered as digits etc).
      if (tok.kind === 'integer' && tok.numeric !== undefined && tok.numeric <= SMALL_INTEGER_FREE_PASS) {
        continue
      }
      const raw = tok.raw.trim()
      if (allowed.has(raw) || allowed.has(raw.toLowerCase())) continue

      // For amounts, also try the numeric value as plain integer.
      if (tok.kind === 'amount' && tok.numeric !== undefined) {
        if (allowed.has(String(Math.round(tok.numeric)))) continue
        if (allowed.has(tok.numeric.toFixed(2))) continue
      }

      // Percent: try numeric stem ("22" from "22%").
      if (tok.kind === 'percent' && tok.numeric !== undefined) {
        if (allowed.has(String(tok.numeric))) continue
      }

      unmatched.push({ field: name, token: raw, kind: tok.kind })
    }
  }

  return { ok: unmatched.length === 0, unmatched }
}
