// Canonical currency formatting helper.
//
// Replaces five inline duplicates flagged in audit/v2.5-component-reuse.md
// (Q2). The signature absorbs the variations each duplicate carried:
//   - null/undefined tolerance (savedCardBuilders had this)
//   - configurable decimals (PatternsClient needed 2, the others 0)
//   - configurable locale (en vs en-GB)
//
// Always renders as an absolute value with a currency symbol prefix —
// sign is the caller's responsibility (use surplus/deficit framing
// in the surrounding copy, not a "-€" in the number itself).

const SYMBOLS: Record<string, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
}

export interface FormatCurrencyOptions {
  /** Fraction digits — 0 by default (whole units). Pass 2 for cents. */
  decimals?: number
  /** Number formatter locale. Defaults to 'en'. */
  locale?: string
}

export function formatCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined = 'EUR',
  opts: FormatCurrencyOptions = {},
): string {
  if (amount === null || amount === undefined) return '—'
  const code = (currency || 'EUR').toUpperCase()
  const symbol = SYMBOLS[code] ?? `${code} `
  const decimals = opts.decimals ?? 0
  const locale = opts.locale ?? 'en'
  return `${symbol}${Math.abs(amount).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}
