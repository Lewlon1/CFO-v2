/**
 * Canonical money rendering.
 *
 * Single source of truth for currency formatting. Replaces the scattered
 * formatters in src/lib/format/currency.ts, src/lib/value-map/format.ts,
 * src/lib/constants/dashboard.ts, and inline helpers across components.
 *
 * Three render modes:
 *   - 'rounded'  → no decimals      (€1,235)   — default
 *   - 'precise'  → 2 decimals       (€1,234.56)
 *   - 'natural'  → 0 if integer,    (€1,234 / €1,234.50)
 *                 2 if fractional
 *
 * Sign behaviour:
 *   - Negative inputs render with a Unicode minus before the symbol (−€50)
 *   - `signed: true` prefixes positives with `+` (+€50)
 *   - Default for positives: no sign (€50)
 *
 * Unknown currencies fall back to `${CODE} ` (code + space) prefix, matching
 * the long-standing contract in src/lib/format/currency.ts.
 */

const SYMBOLS: Record<string, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
}

export type MoneyFormat = 'rounded' | 'precise' | 'natural'

export interface FormatMoneyOpts {
  currency: string
  format?: MoneyFormat
  signed?: boolean
  locale?: string
}

export function moneySymbol(currency: string): string {
  const code = (currency ?? '').toUpperCase()
  return SYMBOLS[code] ?? `${code} `
}

export function formatMoney(amount: number, opts: FormatMoneyOpts): string {
  const { currency, format = 'rounded', signed = false, locale = 'en' } = opts
  const symbol = moneySymbol(currency)

  const fractionDigits = (() => {
    switch (format) {
      case 'rounded':
        return { min: 0, max: 0 }
      case 'precise':
        return { min: 2, max: 2 }
      case 'natural':
        return { min: amount % 1 === 0 ? 0 : 2, max: 2 }
    }
  })()

  const absStr = Math.abs(amount).toLocaleString(locale, {
    minimumFractionDigits: fractionDigits.min,
    maximumFractionDigits: fractionDigits.max,
  })

  if (amount < 0) return `−${symbol}${absStr}`
  if (signed && amount > 0) return `+${symbol}${absStr}`
  return `${symbol}${absStr}`
}

/**
 * Sanitise a raw money input string for display in a text field.
 *
 * Keeps digits and a single decimal point; strips currency symbols, thousands
 * separators (commas/spaces), and any character that isn't a digit or the first
 * dot; collapses leading zeros ("05" → "5", but "0.5" is preserved). This is
 * the deterministic, locale-agnostic guard that replaces the old
 * `type="number"` inputs whose string state let "5.200" parse to 5.2 and
 * preserved leading zeros while typing.
 *
 * Note: the decimal separator on input is the dot. A bare leading "." becomes
 * "0." so the field reads naturally as the user types a fractional amount.
 */
export function sanitizeMoneyInput(raw: string): string {
  if (!raw) return ''
  // Drop everything except digits and dots.
  let cleaned = raw.replace(/[^0-9.]/g, '')
  // No digits at all (e.g. a lone "." or "..") is not a value.
  if (!/[0-9]/.test(cleaned)) return ''
  // Keep only the first dot.
  const firstDot = cleaned.indexOf('.')
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, '')
  }
  // Split into integer / fraction around the (single) dot.
  const dotIndex = cleaned.indexOf('.')
  if (dotIndex === -1) {
    // Integer only — strip leading zeros, but keep a single "0".
    const stripped = cleaned.replace(/^0+(?=\d)/, '')
    return stripped
  }
  let intPart = cleaned.slice(0, dotIndex).replace(/^0+(?=\d)/, '')
  const fracPart = cleaned.slice(dotIndex + 1)
  if (intPart === '') intPart = '0'
  return `${intPart}.${fracPart}`
}

/**
 * Parse a (possibly raw) money input string to a number, or null if it isn't a
 * valid positive-or-zero amount. Sanitises first so commas / leading zeros /
 * stray separators never corrupt the value.
 */
export function parseMoneyInput(raw: string): number | null {
  const sanitised = sanitizeMoneyInput(raw)
  if (sanitised === '' || sanitised === '.') return null
  const value = Number(sanitised)
  return Number.isFinite(value) ? value : null
}
