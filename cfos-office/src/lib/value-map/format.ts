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
