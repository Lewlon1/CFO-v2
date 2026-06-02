// Single source of truth for category-aware P&L classification.
// Used by monthly snapshots, dashboard summary, CFO tools, and the insight engine
// so income / spending / refunds are computed identically everywhere.

export const NEUTRAL_CATEGORY_IDS = ['transfers', 'debt_repayments', 'savings_investments'] as const
export const INCOME_CATEGORY_ID = 'income'

// Synthetic slug used by snapshots and the dashboard for transactions whose
// category_id is NULL (rules engine + LLM fallback couldn't classify them).
// They still count toward total_spending and surface as an "Uncategorised"
// bucket in the breakdown so the user can see and recategorise them.
export const UNCATEGORISED_CATEGORY_ID = 'uncategorised'

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

// Categories a `cut` lever may target — genuinely reducible discretionary spend.
// Excludes essentials/fixed (housing, utilities_bills, groceries, transport,
// health), debt, income, savings, transfers, and uncategorised. A cut lever on
// any of those is either impossible (rent, council tax, water) or harmful
// (groceries, health) — that was the renfe / council-tax failure mode where the
// recurring-expense-sourced cut lever surfaced an essential or a variable
// transport line as "the bill to trim". See SESSION-LOG.
export const DISCRETIONARY_CATEGORY_IDS: ReadonlySet<string> = new Set([
  'eat_drinking_out',
  'subscriptions',
  'entertainment',
  'shopping',
  'travel',
  'personal_care',
  'pets',
])

// Human-readable label for a category slug, for prose surfaces (the Read, chat).
// Overrides cover the slugs that don't humanise cleanly; everything else falls
// back to swapping separators for spaces. Lowercase reads naturally mid-sentence
// ("eating & drinking out runs €X"). NEVER surface the raw slug to the user.
const CATEGORY_LABELS: Record<string, string> = {
  eat_drinking_out: 'eating & drinking out',
  utilities_bills: 'utilities & bills',
  savings_investments: 'savings & investments',
  debt_repayments: 'debt repayments',
  personal_care: 'personal care',
}

export function categoryLabel(slug: string | null | undefined): string {
  const key = (slug ?? '').trim().toLowerCase()
  if (!key || key === 'uncategorised') return 'uncategorised'
  return CATEGORY_LABELS[key] ?? key.replace(/[_-]+/g, ' ')
}
