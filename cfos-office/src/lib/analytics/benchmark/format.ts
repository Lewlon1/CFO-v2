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

  return `${args.label} at ${amount}/month sits above the typical ${country} range of ${lo}–${hi}. Source: ${args.verdict.source}.`
}
