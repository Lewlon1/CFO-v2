/**
 * Rounded (0-decimal) currency formatter for office dashboards.
 *
 * Now a compatibility shim — delegates to the canonical `formatMoney`
 * in `./money`. New callers should use `formatMoney(amount, { currency })`
 * directly.
 *
 * Refs: docs/audits/2026-05-01-component-consolidation.md §3 Extraction A
 */

import { formatMoney } from './money'

export function formatCurrencyRounded(amount: number, currency = 'EUR'): string {
  return formatMoney(amount, { currency, format: 'rounded' })
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
