// Safe-phrasing helper for benchmark observations. All deterministic copy
// that mentions a benchmark goes through this single function so the boundary
// language (no "switch", "should", "overpaying", "recommend", named provider)
// is enforced in one place.
//
// The renderer accepts only structured fields — label, amount, currency, the
// verdict's bands, the country code, the source. No upstream string is
// concatenated into the output uninspected.

import { formatCurrency } from '@/lib/format/currency'
import type { BenchmarkCountry, BenchmarkVerdict } from './types'

const COUNTRY_LABELS: Record<BenchmarkCountry, string> = {
  GB: 'UK',
  ES: 'Spain',
}

/**
 * One-line observation for the confirm UI and the First Read fact section.
 * Only renders for verdict === 'above'; returns null otherwise so the caller
 * stays silent on within / below.
 *
 * Example output:
 *   "Octopus broadband at £45/month sits above the typical UK range of
 *    £25–£35. Source: Ofcom Pricing Trends."
 *
 * When the source is unsourced (TEST: / TODO:) or doesn't reduce to a
 * sensible short citation, the source clause is dropped entirely rather than
 * leaked verbatim to the user. The boundary stays observational either way.
 */
export function formatBenchmarkObservation(args: {
  label: string
  monthly_amount: number
  verdict: BenchmarkVerdict
}): string | null {
  if (args.verdict.verdict !== 'above') return null

  const country = COUNTRY_LABELS[args.verdict.country]
  const amount = formatCurrency(args.monthly_amount, args.verdict.currency)
  const lo = formatCurrency(args.verdict.band_low, args.verdict.currency)
  const hi = formatCurrency(args.verdict.band_high, args.verdict.currency)
  const citation = sanitiseCitation(args.verdict.source)

  const head = `${args.label} at ${amount}/month sits above the typical ${country} range of ${lo}–${hi}`
  return citation ? `${head}. Source: ${citation}.` : `${head}.`
}

/**
 * Shape the raw `benchmark_reference.source` column into a user-safe citation,
 * or return null so the caller emits no source clause at all. Two reasons we
 * never pass the raw column through:
 *
 *   1. Unsourced bands carry a `TODO: …` marker as a sourcing hint to Lewis.
 *      We surface those rows silently (no source phrase) rather than printing
 *      "Source: TODO: Ofcom Pricing Trends." to the user.
 *   2. Demo / test seeds carry `TEST: …`. Same logic — we want the rest of the
 *      observation to render correctly without leaking the seed metadata.
 *
 * For real sources, we keep only the leading clause (before the first comma
 * or paren) so "CNMC sector report (telecoms)" → "CNMC sector report" and
 * "Ofcom Pricing Trends, single household, 2025" → "Ofcom Pricing Trends".
 * Anything still suspiciously long (>60 chars) gets dropped — better silent
 * than verbose.
 */
function sanitiseCitation(source: string): string | null {
  const trimmed = source.trim()
  if (/^(TEST|TODO)\b/i.test(trimmed)) return null
  const head = trimmed.split(/[,(]/)[0].trim()
  if (head.length === 0 || head.length > 60) return null
  return head
}
