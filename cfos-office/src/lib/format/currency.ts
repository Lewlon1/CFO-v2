// Currency formatting compatibility shim — routes through the canonical
// `formatMoney` in `src/lib/utils/money.ts`.
//
// Contract preserved verbatim from the pre-consolidation helper:
//   - null/undefined → '—'
//   - absolute value rendered (sign is the caller's responsibility)
//   - manual symbol map (€/£/$ for known; `CODE ` for unknown)
//   - `decimals: 0 | 2` toggle, optional `locale`
//
// New callers should import `formatMoney` directly from `@/lib/utils/money`.

import { formatMoney, type MoneyFormat } from '@/lib/utils/money'

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
  const format: MoneyFormat = (opts.decimals ?? 0) === 2 ? 'precise' : 'rounded'
  return formatMoney(Math.abs(amount), {
    currency: code,
    format,
    locale: opts.locale ?? 'en',
  })
}
