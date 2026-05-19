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
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    label: 'Foundation',
    description: 'Essential to daily life',
  },
  investment: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    label: 'Investment',
    description: 'Builds your future',
  },
  leak: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
    label: 'Leak',
    description: 'Drains without return',
  },
  burden: {
    bg: 'bg-stone-500/10',
    text: 'text-stone-400',
    border: 'border-stone-500/20',
    label: 'Burden',
    description: 'Necessary but resented',
  },
  unsure: {
    bg: 'bg-gray-500/10',
    text: 'text-gray-400',
    border: 'border-gray-500/20',
    label: 'Unsure',
    description: 'Not yet classified',
  },
}

export function formatCurrency(amount: number, currency = 'EUR'): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency
  return `${symbol}${Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatMonth(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.length === 7 ? '-01' : ''))
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export function formatShortMonth(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.length === 7 ? '-01' : ''))
  return d.toLocaleDateString('en-GB', { month: 'short' })
}
