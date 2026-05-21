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

import type { SupabaseClient } from '@supabase/supabase-js'

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
 * Server-side helper for fetching the user's currency. Components should
 * receive currency via props/context — never call this from a render path.
 */
export async function resolveUserCurrency(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', userId)
    .single()
  return ((data?.primary_currency as string | null) ?? 'EUR').toUpperCase()
}
