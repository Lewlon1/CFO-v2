import { formatMoney } from '@/lib/utils/money'

// Category color field → hex mapping (matches categories.color in DB)
export const CATEGORY_COLORS: Record<string, string> = {
  primary: '#3B82F6',
  success: '#10B981',
  blue: '#6366F1',
  gold: '#F59E0B',
  orange: '#F97316',
  teal: '#14B8A6',
  purple: '#9C8B7A',
  warning: '#EAB308',
  pink: '#EC4899',
}

export const VALUE_COLORS: Record<
  string,
  { bg: string; text: string; border: string; label: string; description: string }
> = {
  foundation: {
    bg: 'bg-value-foundation/10',
    text: 'text-value-foundation',
    border: 'border-value-foundation/20',
    label: 'Foundation',
    description: 'Essential to daily life',
  },
  investment: {
    bg: 'bg-value-investment/10',
    text: 'text-value-investment',
    border: 'border-value-investment/20',
    label: 'Investment',
    description: 'Builds your future',
  },
  leak: {
    bg: 'bg-value-leak/10',
    text: 'text-value-leak',
    border: 'border-value-leak/20',
    label: 'Leak',
    description: 'Drains without return',
  },
  burden: {
    bg: 'bg-value-burden/10',
    text: 'text-value-burden',
    border: 'border-value-burden/20',
    label: 'Burden',
    description: 'Necessary but resented',
  },
  unsure: {
    bg: 'bg-value-unsure/10',
    text: 'text-value-unsure',
    border: 'border-value-unsure/20',
    label: 'Unsure',
    description: 'Not yet classified',
  },
}

/**
 * 2-decimal legacy formatter kept for dashboard/balance-sheet surfaces.
 * Shims through the canonical `formatMoney` in `@/lib/utils/money`.
 */
export function formatCurrency(amount: number, currency = 'EUR'): string {
  return formatMoney(Math.abs(amount), { currency, format: 'precise', locale: 'en-GB' })
}

export function formatMonth(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.length === 7 ? '-01' : ''))
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export function formatShortMonth(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.length === 7 ? '-01' : ''))
  return d.toLocaleDateString('en-GB', { month: 'short' })
}
