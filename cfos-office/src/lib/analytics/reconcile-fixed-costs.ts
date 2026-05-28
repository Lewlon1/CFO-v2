// Reconcile user-declared fixed costs against the auto-detected recurring
// set, producing a deduped list + a single monthly equivalent total that
// lands in `monthly_snapshots.total_fixed_costs`.
//
// The rule that matters: a doubled rent (user types "950" AND the detector
// found a "950" cluster) MUST count once. The First Read's free-cash-flow
// figure derives from this total — a wrong total poisons the headline of
// the entire onboarding, kills trust on first impression. Treat the match
// rule as load-bearing.
//
// Match rule: a declared entry matches a detected recurring item when
//   - their monthly-equivalent amounts differ by ≤ 10%, AND
//   - the cadence is the same or adjacent on the canonical ladder.
//
// On match: the declared entry's label is canonical (user's words win);
// the recurring item is marked "matched-not-additive" — it does NOT
// double-count toward the total.

import type { SupabaseClient } from '@supabase/supabase-js'
import { monthlyEquivalent } from './recurring-detector'
import { flagAgainstBenchmark, type BenchmarkFlag } from './flag-against-benchmark'

/** Cadence ladder used for adjacency matching. Order matters. */
const CADENCE_LADDER = [
  'weekly',
  'bi-weekly',
  'monthly',
  'bi-monthly',
  'quarterly',
  'annual',
] as const
export type Cadence = (typeof CADENCE_LADDER)[number]

const AMOUNT_BAND = 0.10 // ±10% — tighter than detector's per-occurrence CV gate
const CADENCE_ADJACENCY = 1 // monthly↔bi-monthly counts as a match

export type FixedCostInput = {
  label: string
  amount: number
  cadence: Cadence
  source: 'rent' | 'declared' | 'detected'
}

export type ReconciledBill = FixedCostInput & {
  monthly_equivalent: number
  /** True when this row was the canonical voice for a detected match. */
  matched_detected: boolean
  /** True when this row was the dedupe loser and contributes 0 to the total. */
  superseded: boolean
  benchmark_flag: BenchmarkFlag | null
}

export type ReconcileResult = {
  items: ReconciledBill[]
  totalFixedCostsMonthly: number
}

function cadenceIndex(c: string): number {
  const i = (CADENCE_LADDER as readonly string[]).indexOf(c)
  return i < 0 ? -1 : i
}

function isCadenceMatch(a: string, b: string): boolean {
  const ai = cadenceIndex(a)
  const bi = cadenceIndex(b)
  if (ai < 0 || bi < 0) return false
  return Math.abs(ai - bi) <= CADENCE_ADJACENCY
}

function isAmountBandMatch(aMonthly: number, bMonthly: number): boolean {
  if (aMonthly <= 0 || bMonthly <= 0) return false
  const diff = Math.abs(aMonthly - bMonthly)
  const denom = Math.max(aMonthly, bMonthly)
  return diff / denom <= AMOUNT_BAND
}

function normaliseCadence(raw: string | null | undefined): Cadence {
  const c = (raw ?? 'monthly').toLowerCase()
  if ((CADENCE_LADDER as readonly string[]).includes(c)) return c as Cadence
  // Defensive: detector may emit 'irregular' for sparse clusters — treat as
  // monthly for total purposes (they won't have qualified anyway).
  return 'monthly'
}

/**
 * Load the user's fixed-cost surfaces and reconcile them.
 *
 * Sources:
 *   1. user_profiles.monthly_rent — the canonical rent / housing line.
 *   2. user_declared_fixed_costs — what the user typed in the processing form.
 *   3. recurring_expenses (status detected | tracked) — what the detector found.
 *
 * The reconcile dedupes declared vs detected on amount-band + cadence, and
 * (optionally) dedupes the rent line against any detected rent-equivalent.
 */
export async function reconcileFixedCosts(
  supabase: SupabaseClient,
  userId: string,
): Promise<ReconcileResult> {
  const [profileRes, declaredRes, recurringRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('monthly_rent, primary_currency')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('user_declared_fixed_costs')
      .select('id, label, amount, cadence, status')
      .eq('user_id', userId)
      .neq('status', 'dismissed'),
    supabase
      .from('recurring_expenses')
      .select('id, name, amount, frequency, status, category_id')
      .eq('user_id', userId)
      .in('status', ['detected', 'tracked']),
  ])

  const monthlyRent =
    typeof profileRes.data?.monthly_rent === 'number'
      ? profileRes.data.monthly_rent
      : null

  const items: ReconciledBill[] = []

  if (monthlyRent != null && monthlyRent > 0) {
    items.push({
      label: 'Housing',
      amount: monthlyRent,
      cadence: 'monthly',
      source: 'rent',
      monthly_equivalent: monthlyRent,
      matched_detected: false,
      superseded: false,
      benchmark_flag: null,
    })
  }

  // Index detected by monthly equivalent so we can match against declared.
  type DetectedSlot = {
    label: string
    amount: number
    cadence: Cadence
    monthly_equivalent: number
    consumed_by_declared: boolean
  }
  const detectedSlots: DetectedSlot[] = (recurringRes.data ?? []).map((r) => {
    const cadence = normaliseCadence(r.frequency as string)
    const amount = Number(r.amount)
    return {
      label: (r.name as string) ?? 'Recurring',
      amount,
      cadence,
      monthly_equivalent: monthlyEquivalent(amount, cadence),
      consumed_by_declared: false,
    }
  })

  // Match declared → detected first. Declared wins on label; detected is
  // marked consumed so it doesn't double-count later. Also dedupe declared
  // entries against the rent line so a user who types rent into the
  // optional bills doesn't count it twice.
  for (const d of declaredRes.data ?? []) {
    const cadence = normaliseCadence(d.cadence as string)
    const amount = Number(d.amount)
    const monthly = monthlyEquivalent(amount, cadence)

    const matchesRent =
      monthlyRent != null &&
      monthlyRent > 0 &&
      isAmountBandMatch(monthly, monthlyRent) &&
      isCadenceMatch(cadence, 'monthly')

    if (matchesRent) {
      // Dedupe loser — don't add to total. Surface in the list so the user
      // sees why it was folded into "Housing".
      items.push({
        label: (d.label as string) ?? 'Recurring bill',
        amount,
        cadence,
        source: 'declared',
        monthly_equivalent: monthly,
        matched_detected: false,
        superseded: true,
        benchmark_flag: null,
      })
      continue
    }

    let matchedSlot: DetectedSlot | null = null
    for (const slot of detectedSlots) {
      if (slot.consumed_by_declared) continue
      if (
        isAmountBandMatch(slot.monthly_equivalent, monthly) &&
        isCadenceMatch(slot.cadence, cadence)
      ) {
        matchedSlot = slot
        slot.consumed_by_declared = true
        break
      }
    }

    const candidate: FixedCostInput = {
      label: (d.label as string) ?? 'Recurring bill',
      amount,
      cadence,
      source: 'declared',
    }
    items.push({
      ...candidate,
      monthly_equivalent: monthly,
      matched_detected: matchedSlot != null,
      superseded: false,
      benchmark_flag: flagAgainstBenchmark(candidate),
    })
  }

  // Now surface the detected items that no declared row claimed AND that
  // don't band-match the rent line.
  for (const slot of detectedSlots) {
    if (slot.consumed_by_declared) continue
    const matchesRent =
      monthlyRent != null &&
      monthlyRent > 0 &&
      isAmountBandMatch(slot.monthly_equivalent, monthlyRent) &&
      isCadenceMatch(slot.cadence, 'monthly')
    if (matchesRent) continue
    const candidate: FixedCostInput = {
      label: slot.label,
      amount: slot.amount,
      cadence: slot.cadence,
      source: 'detected',
    }
    items.push({
      ...candidate,
      monthly_equivalent: slot.monthly_equivalent,
      matched_detected: false,
      superseded: false,
      benchmark_flag: flagAgainstBenchmark(candidate),
    })
  }

  const totalFixedCostsMonthly = items.reduce(
    (sum, item) => (item.superseded ? sum : sum + item.monthly_equivalent),
    0,
  )

  return { items, totalFixedCostsMonthly: Math.round(totalFixedCostsMonthly * 100) / 100 }
}
