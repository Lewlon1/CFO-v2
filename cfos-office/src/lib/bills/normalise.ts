/**
 * Normalise a bill amount to a monthly equivalent based on billing frequency.
 */
export function normaliseToMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case 'bimonthly':
      return amount / 2
    case 'quarterly':
      return amount / 3
    case 'semiannual':
      return amount / 6
    case 'annual':
    case 'yearly':
      return amount / 12
    default:
      return amount // monthly or unknown
  }
}

/**
 * Infer billing frequency from the number of days in a billing period.
 */
export function inferFrequencyFromDays(days: number): string {
  if (days <= 35) return 'monthly'
  if (days <= 65) return 'bimonthly'
  if (days <= 100) return 'quarterly'
  if (days <= 200) return 'semiannual'
  return 'annual'
}

/**
 * Human-readable frequency label.
 */
export function frequencyLabel(frequency: string): string {
  switch (frequency) {
    case 'monthly':
      return '/mo'
    case 'bimonthly':
      return '/2mo'
    case 'quarterly':
      return '/3mo'
    case 'semiannual':
      return '/6mo'
    case 'annual':
    case 'yearly':
      return '/yr'
    default:
      return `/${frequency}`
  }
}
