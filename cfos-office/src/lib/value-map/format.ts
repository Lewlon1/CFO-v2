/**
 * Shared formatting helpers for value-map and transaction classification UIs.
 *
 * `currencySymbol` and `formatAmount` are compatibility shims — they delegate
 * to the canonical `moneySymbol` / `formatMoney` in `@/lib/utils/money`.
 * New callers should import from there directly.
 */

import { formatMoney, moneySymbol } from '@/lib/utils/money'

export function currencySymbol(currency: string): string {
  return moneySymbol(currency)
}

export function formatAmount(amount: number, currency: string): string {
  return formatMoney(amount, { currency, format: 'natural' })
}

export function formatDate(dateStr: string): string {
  try {
    // Handle both "YYYY-MM-DD" and full ISO timestamps
    const d = new Date(dateStr.length <= 10 ? dateStr + 'T00:00:00' : dateStr)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return dateStr
  }
}

/**
 * Like `formatDate` but prefixes the weekday — e.g. "Fri 28 May".
 *
 * Uses the same length-aware parse as `formatDate` (so full ISO timestamps,
 * which real transactions carry, don't break — the bug that previously
 * surfaced as "Invalid Date" in the Value Map card came from appending
 * `T00:00:00` unconditionally). Guards against an unparseable date by falling
 * back to the weekday-less form.
 */
export function formatDateWithDay(dateStr: string): string {
  const d = new Date(dateStr.length <= 10 ? dateStr + 'T00:00:00' : dateStr)
  if (Number.isNaN(d.getTime())) return formatDate(dateStr)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
