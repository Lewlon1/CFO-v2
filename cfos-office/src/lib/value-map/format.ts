/** Shared formatting helpers for value-map and transaction classification UIs */

export function currencySymbol(currency: string): string {
  return { GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[currency] ?? currency + ' '
}

export function formatAmount(amount: number, currency: string): string {
  const sym = currencySymbol(currency)
  return `${sym}${amount.toLocaleString('en', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
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
