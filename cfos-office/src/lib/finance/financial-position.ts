// One financial-position module — Rule 8 (one source of truth per fact).
//
// Before this module existed, the same three numbers (fixed costs, average
// discretionary spend, free cash / surplus) were computed independently in
// at least four places (helpers.ts's loadCurrentBudget, levers.ts's
// computeCurrentSurplus, compose-first-read.ts's getFinancialFacts, and
// calculate-monthly-budget.ts), each with its own bugs: one summed raw
// recurring_expenses with no rent/declared-bills/status filter, another
// read a monthly_snapshots column that didn't exist and silently treated
// the Supabase 42703 error as "the user spends nothing". The dorcas/lewis
// staging review traced every false "funded at plan / spare cash" figure
// to exactly these divergent, individually-buggy computations.
//
// Every consumer of income/fixed-costs/discretionary/surplus must read from
// getFinancialPosition. Do not re-derive any of these numbers elsewhere.

import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileFixedCosts } from '@/lib/analytics/reconcile-fixed-costs'

export type FinancialPositionBasis = 'observed' | 'modelled'

export interface FinancialPosition {
  /** Net monthly income + partner contribution. Null when no income is on file. */
  income: number | null
  /** Where `income` came from: 'observed' | 'declared_unverified' | 'unknown' | null (never detected). */
  incomeProvenance: string | null
  /** Reconciled monthly fixed-cost total: rent + declared bills + confirmed/detected recurring, deduped (never double-counts a declared bill against its detector-matched twin). */
  fixedCostsMonthly: number
  /** Average of the last 3 months' observed total_spending. Null when no snapshot history exists yet. */
  avgObservedSpendMonthly: number | null
  /** Average of the last 3 months' non-fixed spend. Null when no snapshot history exists yet — NEVER coerce this to 0 at the call site; a missing average means "unknown", not "zero". */
  avgDiscretionaryMonthly: number | null
  /** income − fixedCostsMonthly − avgDiscretionaryMonthly (or income − fixedCostsMonthly when avgDiscretionaryMonthly is unavailable — see `basis`). Null when income is absent. THE free-cash-flow figure; every consumer reads it from here, never recomputes it. */
  freeCash: number | null
  /** Alias for `freeCash`, kept for call sites migrating off the old "surplus" naming — identical value. */
  observedSurplus: number | null
  /**
   * 'observed' — avgDiscretionaryMonthly came from real snapshot history, so
   * freeCash reflects actual spending. 'modelled' — no snapshot history
   * exists yet (or the reconcile itself failed), so freeCash is only
   * income minus fixed costs: a declared-only estimate that assumes zero
   * day-to-day spending. Any "funded" / "stress case covered" framing MUST
   * gate on basis === 'observed', or explicitly caveat the figure as
   * modelled — never state a modelled surplus as a confirmed fact.
   */
  basis: FinancialPositionBasis
  /** Raw profile fields some legacy call sites still need — carried through so they don't need a second profile fetch. */
  monthlyRent: number | null
  grossSalary: number | null
  partnerContribution: number
}

const SNAPSHOT_LOOKBACK = 3

export async function getFinancialPosition(
  supabase: SupabaseClient,
  userId: string,
): Promise<FinancialPosition> {
  const [profileRes, reconciled, snapshotsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select(
        'net_monthly_income, gross_salary, partner_monthly_contribution, monthly_rent, income_provenance',
      )
      .eq('id', userId)
      .maybeSingle(),
    reconcileFixedCosts(supabase, userId).catch((err) => {
      console.error('[financial-position] reconcileFixedCosts failed:', err)
      return null
    }),
    supabase
      .from('monthly_snapshots')
      .select('total_spending, total_discretionary')
      .eq('user_id', userId)
      .order('month', { ascending: false })
      .limit(SNAPSHOT_LOOKBACK),
  ])

  if (profileRes.error) {
    console.error('[financial-position] user_profiles read failed:', profileRes.error)
  }
  if (snapshotsRes.error) {
    console.error('[financial-position] monthly_snapshots read failed:', snapshotsRes.error)
  }

  const profile = profileRes.data
  const netIncome =
    typeof profile?.net_monthly_income === 'number' ? profile.net_monthly_income : null
  const partnerContribution =
    typeof profile?.partner_monthly_contribution === 'number'
      ? profile.partner_monthly_contribution
      : 0
  const income = netIncome != null ? netIncome + partnerContribution : null

  const fixedCostsMonthly = reconciled?.totalFixedCostsMonthly ?? 0
  const reconcileFailed = reconciled == null

  const rows = snapshotsRes.data ?? []
  const avgObservedSpendMonthly = average(
    rows.map((r) => (typeof r.total_spending === 'number' ? r.total_spending : null)),
  )
  const avgDiscretionaryMonthly = average(
    rows.map((r) => (typeof r.total_discretionary === 'number' ? r.total_discretionary : null)),
  )

  let freeCash: number | null = null
  let basis: FinancialPositionBasis = 'modelled'
  if (income != null && !reconcileFailed) {
    if (avgDiscretionaryMonthly != null) {
      freeCash = income - fixedCostsMonthly - avgDiscretionaryMonthly
      basis = 'observed'
    } else {
      freeCash = income - fixedCostsMonthly
      basis = 'modelled'
    }
  }

  return {
    income,
    incomeProvenance:
      typeof profile?.income_provenance === 'string' ? profile.income_provenance : null,
    fixedCostsMonthly,
    avgObservedSpendMonthly,
    avgDiscretionaryMonthly,
    freeCash,
    observedSurplus: freeCash,
    basis,
    monthlyRent: typeof profile?.monthly_rent === 'number' ? profile.monthly_rent : null,
    grossSalary: typeof profile?.gross_salary === 'number' ? profile.gross_salary : null,
    partnerContribution,
  }
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v != null)
  if (valid.length === 0) return null
  return valid.reduce((s, v) => s + v, 0) / valid.length
}
