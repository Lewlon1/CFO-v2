// Above-peer-average bill flagging — STUB.
//
// TODO(benchmark-session): wire this against the benchmark dataset.
// The companion "benchmark session" lands a peer-comparison surface (e.g.
// "your fibre at £58 is above the £45 median for ES major-city users"),
// which becomes the only place "above average" claims appear in the
// product — the advisory boundary lets us *observe* peer comparisons but
// not recommend products on top of them.
//
// Until that session lands this function ALWAYS returns null. The reconcile
// helper and the confirm/reconcile UI both call it and render nothing when
// the result is null, so wiring the real implementation later won't require
// any UI restructuring — just flip on the return value.

import type { FixedCostInput } from './reconcile-fixed-costs'

export type BenchmarkFlag = {
  severity: 'above' | 'far_above'
  benchmark_amount: number
  user_amount: number
  pct_above: number
  /** Country-city pair used to derive the benchmark, if available. */
  scope: { country: string | null; city: string | null }
}

/**
 * Compare a single bill against the per-user-segment benchmark and return
 * a flag when the user is materially above the median. Returns null when
 * the bill is within band, when the benchmark dataset is unavailable, or
 * when the user's segment metadata is too thin to derive a peer cohort.
 */
export function flagAgainstBenchmark(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  bill: FixedCostInput,
): BenchmarkFlag | null {
  // TODO(benchmark-session): integrate.
  return null
}
