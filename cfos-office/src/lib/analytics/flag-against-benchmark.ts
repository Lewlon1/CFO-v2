// Bill benchmark flagger — compares a bill's monthly equivalent against the
// published band in `benchmark_reference` and returns an observational
// verdict (above / within / below) with the band + source cited.
//
// Discipline (load-bearing — see the session plan):
//   - Band, never a point. The verdict carries band_low / band_high.
//   - Source or silence. NULL bands → null verdict (the table seeds with
//     TODO sources and NULL bands; the flagger handles that as "not yet
//     sourced" without any code-level allowlisting).
//   - Contractual / fixed categories only. The `bill_subtype` enum is the
//     allowlist; lifestyle-variable spend can't be encoded into a row.
//   - Observe never prescribe. This function never names a provider, never
//     emits switch / recommend / should language — its output is structured
//     data, the consumer renders neutral copy from a hard-coded helper.

import type { SupabaseClient } from '@supabase/supabase-js'

import { monthlyEquivalent } from './recurring-detector'
import type { FixedCostInput } from './reconcile-fixed-costs'
import {
  isBenchmarkCountry,
  type BenchmarkCountry,
  type BenchmarkVerdict,
  type BillSubtype,
} from './benchmark/types'

export type { BenchmarkVerdict, BillSubtype } from './benchmark/types'

export type FlagInput = FixedCostInput & {
  /** Server-side classifier output; null silences the flagger by design. */
  bill_subtype: BillSubtype | null
}

/**
 * Compare a single bill against the published per-(country, bill_subtype)
 * band. Returns null when:
 *   - the bill has no resolved subtype (the classifier was unsure)
 *   - the user has no country on file
 *   - the country is outside the benchmark allowlist
 *   - no `benchmark_reference` row matches
 *   - the matching row has unsourced bands (`band_low` or `band_high` NULL)
 *
 * Silence is the safe default — better no observation than a wrong one.
 */
export async function flagAgainstBenchmark(
  supabase: SupabaseClient,
  bill: FlagInput,
  country: string | null,
): Promise<BenchmarkVerdict | null> {
  if (bill.bill_subtype == null) return null
  if (!isBenchmarkCountry(country)) return null

  const { data, error } = await supabase
    .from('benchmark_reference')
    .select('band_low, band_high, currency, basis, source')
    .eq('country', country)
    .eq('bill_subtype', bill.bill_subtype)
    .maybeSingle()

  if (error) {
    console.error('[flag-against-benchmark] benchmark_reference query failed:', error)
    return null
  }
  if (!data) return null

  const bandLow = typeof data.band_low === 'number' ? data.band_low : parseNumeric(data.band_low)
  const bandHigh =
    typeof data.band_high === 'number' ? data.band_high : parseNumeric(data.band_high)
  if (bandLow == null || bandHigh == null) return null

  const monthly = monthlyEquivalent(Math.abs(bill.amount), bill.cadence)

  let verdict: BenchmarkVerdict['verdict']
  if (monthly > bandHigh) verdict = 'above'
  else if (monthly < bandLow) verdict = 'below'
  else verdict = 'within'

  return {
    verdict,
    band_low: bandLow,
    band_high: bandHigh,
    currency: data.currency as string,
    source: data.source as string,
    basis: data.basis as string,
    bill_subtype: bill.bill_subtype,
    country: country as BenchmarkCountry,
  }
}

/**
 * Supabase returns NUMERIC columns as strings under some clients. Coerce to
 * number while preserving null when the input was unsourced.
 */
function parseNumeric(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}
