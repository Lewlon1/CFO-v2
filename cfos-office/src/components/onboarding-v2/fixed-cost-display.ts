// Display-only helpers shared by the confirm-screen sections (orchestrator,
// candidate cards, missing-costs capture). The component layer performs NO
// arithmetic that lands in total_fixed_costs — these power the live, for-
// legibility figures only. The authoritative total is recomputed server-side
// by syncTotalFixedCosts after commit (see reconcile-fixed-costs.ts /
// recurring-detector.ts monthlyEquivalent, the source of truth).

import type { Cadence } from '@/lib/analytics/reconcile-fixed-costs'
import type { CoverageKey } from '@/lib/analytics/category-coverage'
import { BILL_SUBTYPES, type BillSubtype } from '@/lib/analytics/benchmark/types'

export const CADENCE_OPTIONS: Array<{ value: Cadence; label: string }> = [
  { value: 'weekly', label: 'weekly' },
  { value: 'bi-weekly', label: 'fortnightly' },
  { value: 'monthly', label: 'monthly' },
  { value: 'bi-monthly', label: 'every 2 months' },
  { value: 'quarterly', label: 'quarterly' },
  { value: 'annual', label: 'yearly' },
]

/** Display-only monthly equivalent. Mirrors recurring-detector.monthlyEquivalent. */
export function monthlyEq(amount: number, cadence: Cadence): number {
  switch (cadence) {
    case 'weekly':
      return amount * 4.33
    case 'bi-weekly':
      return amount * 2.17
    case 'monthly':
      return amount
    case 'bi-monthly':
      return amount / 2
    case 'quarterly':
      return amount / 3
    case 'annual':
      return amount / 12
    default:
      return amount
  }
}

/** First-letter capitalisation for normalised merchant keys ("tmb" → "Tmb"). */
export function capitaliseLabel(name: string): string {
  if (!name) return name
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * A coverage key that is also a benchmark subtype (electricity/gas/broadband/
 * mobile) carries that subtype onto the captured declared row; water / housing
 * / insurance_any have no enum value, so they persist as null.
 */
export function keyToBillSubtype(key: CoverageKey): BillSubtype | null {
  return (BILL_SUBTYPES as readonly string[]).includes(key) ? (key as BillSubtype) : null
}
