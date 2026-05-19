/**
 * Cash Flow Aggregates
 *
 * Pure functions computing T3M income/spend, runway days, and balance
 * trajectory from monthly snapshots + liquid balance. Inputs to the
 * posture detector. No LLM calls, no DB access.
 *
 * Single-currency assumption: amounts are summed naively. Multi-currency
 * users will see noisy runway figures until FX normalisation is added.
 */

export type BalanceTrajectory =
  | 'growing'
  | 'growing_slowly'
  | 'flat'
  | 'shrinking'
  | 'unknown'

export interface MonthlySnapshotRow {
  month: string // 'YYYY-MM-01'
  income_total: number
  spend_total: number
  closing_balance: number | null // null pre-Session-B or when balance unknown
}

export interface CashFlowAggregates {
  t3m_income_monthly: number | null
  t3m_spend_monthly: number | null
  runway_days: number | null
  balance_trajectory: BalanceTrajectory
  months_observed: number
}

// Below this many months, trajectory is 'unknown' and aggregates are null.
const MIN_MONTHS = 2

export function computeCashFlowAggregates(
  snapshots: MonthlySnapshotRow[],
  liquid_balance: number | null,
): CashFlowAggregates {
  // Most-recent-first, take last 3.
  const sorted = [...snapshots]
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, 3)

  if (sorted.length < MIN_MONTHS) {
    return {
      t3m_income_monthly: null,
      t3m_spend_monthly: null,
      runway_days: null,
      balance_trajectory: 'unknown',
      months_observed: sorted.length,
    }
  }

  const t3m_income =
    sorted.reduce((s, r) => s + (Number(r.income_total) || 0), 0) / sorted.length
  const t3m_spend =
    sorted.reduce((s, r) => s + (Number(r.spend_total) || 0), 0) / sorted.length

  const runway =
    liquid_balance !== null && t3m_spend > 0
      ? Math.round(liquid_balance / (t3m_spend / 30))
      : null

  return {
    t3m_income_monthly: Math.round(t3m_income * 100) / 100,
    t3m_spend_monthly: Math.round(t3m_spend * 100) / 100,
    runway_days: runway,
    balance_trajectory: computeTrajectory(sorted),
    months_observed: sorted.length,
  }
}

function computeTrajectory(sorted: MonthlySnapshotRow[]): BalanceTrajectory {
  // `sorted` is most-recent first.
  const newest = sorted[0]
  const oldest = sorted[sorted.length - 1]
  if (newest.closing_balance === null || oldest.closing_balance === null) {
    return 'unknown'
  }
  const delta = newest.closing_balance - oldest.closing_balance
  const baseAvg =
    (Math.abs(newest.closing_balance) + Math.abs(oldest.closing_balance)) / 2
  if (baseAvg === 0) return 'flat'

  const pctChange = delta / baseAvg
  if (pctChange > 0.25) return 'growing'
  if (pctChange > 0.05) return 'growing_slowly'
  if (pctChange > -0.05) return 'flat'
  return 'shrinking'
}
