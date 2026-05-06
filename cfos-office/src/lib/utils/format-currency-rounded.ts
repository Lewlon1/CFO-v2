/**
 * Currency formatter for the office dashboards.
 *
 * Uses Intl with 0 fractional digits — distinct from
 * `lib/constants/dashboard.ts`'s `formatCurrency` (2 decimals, manual symbol).
 * The two coexist intentionally: legacy dashboard/balance-sheet surfaces use
 * the precise variant; office dashboards use this rounded variant.
 *
 * Refs: docs/audits/2026-05-01-component-consolidation.md §3 Extraction A
 */
export function formatCurrencyRounded(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Short month label used in office dashboards' trend strips.
 * Accepts a 'YYYY-MM' or 'YYYY-MM-DD' string and renders the local-timezone
 * abbreviated month name. Lives here as a sibling so dashboards have a
 * single utility import.
 */
export function formatMonthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' })
}
