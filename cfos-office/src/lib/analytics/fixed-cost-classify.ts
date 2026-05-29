// Commitment classifier — splits "recurring" into committed (counts toward
// total_fixed_costs / free cash flow) vs variable (recurring spend that
// flexes: a coffee habit, the weekly shop). Pure function, no DB.
//
// The discretionary set is the CANONICAL category_id slugs (see
// supabase/migrations/003_category_system.sql) for pure-consumption spend.
// It is deliberately MINIMAL: only the categories that, when they recur, are
// almost always lifestyle spend rather than a commitment. Everything else —
// transport (a metro pass), subscriptions, entertainment (a club / court
// membership), health (a gym), utilities — defaults to committed so the
// candidate pass can still surface it for confirmation.
//
// Bias: under-counting fixed costs overstates free cash flow, which is the
// failure mode this session closes. So when in doubt, treat as committed.

import type { BillSubtype } from './benchmark/types'

export type Commitment = 'committed' | 'variable'

// Canonical discretionary category_id slugs (003 seed). NOT 'entertainment'
// (Playtomic), 'transport' (TMB/Shell), or 'subscriptions' (Claude.ai) — those
// stay committed by design.
export const DISCRETIONARY_CATEGORY_IDS: ReadonlySet<string> = new Set<string>([
  'groceries',
  'eat_drinking_out',
  'shopping',
])

/**
 * A row is variable only when it has no benchmarkable subtype AND its category
 * is discretionary. Anything with a fixed subtype, or any non-discretionary /
 * unknown category, is treated as committed. Conservative on purpose: we'd
 * rather count a real bill than silently drop one.
 */
export function classifyCommitment(row: {
  category_id?: string | null
  bill_subtype?: BillSubtype | null
}): Commitment {
  if (row.bill_subtype) return 'committed'
  if (row.category_id && DISCRETIONARY_CATEGORY_IDS.has(row.category_id)) {
    return 'variable'
  }
  return 'committed'
}
