// Types for the bill-benchmark reference layer.
//
// `BillSubtype` mirrors the Postgres enum declared in migration 068. Keep the
// two definitions in lockstep — adding a value here without the migration
// produces silent classifier outputs that the DB can't store.

export const BILL_SUBTYPES = [
  'broadband',
  'mobile',
  'electricity',
  'gas',
  'home_insurance',
  'auto_insurance',
  'streaming_subscription',
] as const

export type BillSubtype = (typeof BILL_SUBTYPES)[number]

export const BENCHMARK_COUNTRIES = ['GB', 'ES'] as const
export type BenchmarkCountry = (typeof BENCHMARK_COUNTRIES)[number]

export function isBenchmarkCountry(country: string | null | undefined): country is BenchmarkCountry {
  return country != null && (BENCHMARK_COUNTRIES as readonly string[]).includes(country)
}

/**
 * The observation returned by `flagAgainstBenchmark` when a bill can be
 * compared. Verdict is `above` only when monthly equivalent clears band_high;
 * the caller decides whether to render `within` / `below` (the First Read
 * narrates only `above`).
 *
 * Band, never a point — band_low / band_high are both required.
 * Source is always cited.
 */
export type BenchmarkVerdict = {
  verdict: 'below' | 'within' | 'above'
  band_low: number
  band_high: number
  currency: string
  source: string
  basis: string
  bill_subtype: BillSubtype
  country: BenchmarkCountry
}
