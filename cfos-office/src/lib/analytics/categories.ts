// Single source of truth for category-aware P&L classification.
// Used by monthly snapshots, dashboard summary, CFO tools, and the insight engine
// so income / spending / refunds are computed identically everywhere.

export const NEUTRAL_CATEGORY_IDS = ['transfers', 'debt_repayments', 'savings_investments'] as const
export const INCOME_CATEGORY_ID = 'income'

const NEUTRAL_SET: ReadonlySet<string> = new Set(NEUTRAL_CATEGORY_IDS)

// Postgres `IN ()` literal for use with PostgREST `.not('category_id', 'in', EXCLUDED_FROM_PL_PG_LIST)`.
export const EXCLUDED_FROM_PL_PG_LIST = `(${[...NEUTRAL_CATEGORY_IDS, INCOME_CATEGORY_ID]
  .map((c) => `"${c}"`)
  .join(',')})`

export function isNeutralCategory(catId: string | null | undefined): boolean {
  return !!catId && NEUTRAL_SET.has(catId)
}

export function isIncomeRow(amount: number | string, catId: string | null | undefined): boolean {
  return Number(amount) > 0 && catId === INCOME_CATEGORY_ID
}

export function isSpendRow(amount: number | string, catId: string | null | undefined): boolean {
  return Number(amount) < 0 && !isNeutralCategory(catId) && catId !== INCOME_CATEGORY_ID
}

export function isRefundRow(amount: number | string, catId: string | null | undefined): boolean {
  return Number(amount) > 0 && !isNeutralCategory(catId) && catId !== INCOME_CATEGORY_ID
}

// True for any row that should affect the spending breakdown (outflow or refund) on a real category.
export function affectsSpendingBreakdown(catId: string | null | undefined): boolean {
  return !!catId && !isNeutralCategory(catId) && catId !== INCOME_CATEGORY_ID
}
