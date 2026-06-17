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
import { flagAgainstBenchmark } from './flag-against-benchmark'
import type { BenchmarkVerdict, BillSubtype } from './benchmark/types'
import { classifyBillSubtype } from './benchmark/classify-subtype'
import { classifyCommitment } from './fixed-cost-classify'

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
  /**
   * Observational benchmark verdict (band-based; never a point). Populated
   * only when the bill has a resolved subtype AND the user's country has a
   * sourced band in `benchmark_reference`. The First Read narrates only
   * verdicts with verdict==='above'; the UI may render `within` / `below`
   * differently in future.
   */
  benchmark_verdict: BenchmarkVerdict | null
  /** Server-classified bill subtype carried through reconcile (audit). */
  bill_subtype: BillSubtype | null
}

export type ReconcileResult = {
  items: ReconciledBill[]
  totalFixedCostsMonthly: number
  /**
   * Detected recurring rows that are discretionary-but-regular (a stable
   * coffee habit) — shown informationally, NEVER summed into the total, so
   * "free cash flow" keeps meaning income minus committed outgoings.
   */
  variableRecurring: ReconciledBill[]
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

// Writers disagree on cadence spelling (recurring-detector emits 'bi-monthly';
// the dashboard summary route + bills/normalise emit 'bimonthly'). Map the known
// no-hyphen / synonym variants onto the canonical ladder so the same merchant
// can't be valued at a different monthly equivalent depending on which writer
// last touched it. Unknown strings still fall back to 'monthly'.
const CADENCE_ALIASES: Record<string, Cadence> = {
  bimonthly: 'bi-monthly',
  'bi monthly': 'bi-monthly',
  biweekly: 'bi-weekly',
  'bi weekly': 'bi-weekly',
  fortnightly: 'bi-weekly',
  yearly: 'annual',
  annually: 'annual',
}

export function normaliseCadence(raw: string | null | undefined): Cadence {
  const c = (raw ?? 'monthly').toLowerCase().trim()
  if ((CADENCE_LADDER as readonly string[]).includes(c)) return c as Cadence
  if (CADENCE_ALIASES[c]) return CADENCE_ALIASES[c]
  // Defensive: detector may emit 'irregular' for sparse clusters — treat as
  // monthly for total purposes (they won't have qualified anyway).
  return 'monthly'
}

/**
 * Collapse case-variant duplicate recurring rows (e.g. "Supabase" + "supabase")
 * by lower(name), keeping the first occurrence. recurring_expenses has a
 * case-SENSITIVE unique constraint, so two writers can insert the same merchant
 * under different casing; summing both double-inflates fixed costs. The durable
 * fix is a case-insensitive constraint + a single writer — this read-side guard
 * protects every reconcile consumer in the meantime.
 */
export function dedupeRecurringByName<T extends { name?: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    const key = (r.name ?? '').trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
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
      .select('monthly_rent, primary_currency, country')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('user_declared_fixed_costs')
      .select('id, label, amount, cadence, status, bill_subtype')
      .eq('user_id', userId)
      .neq('status', 'dismissed'),
    supabase
      .from('recurring_expenses')
      .select('id, name, amount, frequency, status, category_id, bill_subtype')
      .eq('user_id', userId)
      .in('status', ['detected', 'tracked']),
  ])

  const monthlyRent =
    typeof profileRes.data?.monthly_rent === 'number'
      ? profileRes.data.monthly_rent
      : null
  const country =
    typeof profileRes.data?.country === 'string' ? (profileRes.data.country as string) : null

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
      benchmark_verdict: null,
      bill_subtype: null,
    })
  }

  // Index detected by monthly equivalent so we can match against declared.
  type DetectedSlot = {
    label: string
    amount: number
    cadence: Cadence
    monthly_equivalent: number
    consumed_by_declared: boolean
    bill_subtype: BillSubtype | null
    category_id: string | null
  }
  const detectedSlots: DetectedSlot[] = dedupeRecurringByName(recurringRes.data ?? []).map((r) => {
    const cadence = normaliseCadence(r.frequency as string)
    const amount = Number(r.amount)
    return {
      label: (r.name as string) ?? 'Recurring',
      amount,
      cadence,
      monthly_equivalent: monthlyEquivalent(amount, cadence),
      consumed_by_declared: false,
      bill_subtype: (r.bill_subtype as BillSubtype | null) ?? null,
      category_id: (r.category_id as string | null) ?? null,
    }
  })

  // Detected rows the user never declared that are discretionary-but-regular
  // (no benchmark subtype + a discretionary category) are held out of the
  // total. They are NOT a commitment, so counting them would understate free
  // cash flow. Surfaced separately for the "Recurring, but it flexes" section.
  const variableRecurring: ReconciledBill[] = []

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
        benchmark_verdict: null,
        bill_subtype: null,
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

    const declaredSubtype = (d.bill_subtype as BillSubtype | null) ?? null
    // Subtype resolution: declared row's stored subtype wins (user / earlier
    // classification), then the matched detected slot, then on-the-fly
    // classification of the label. The flagger silences itself when all
    // three return null.
    const resolvedSubtype: BillSubtype | null =
      declaredSubtype ??
      matchedSlot?.bill_subtype ??
      classifyBillSubtype((d.label as string) ?? '').subtype

    const candidate: FixedCostInput = {
      label: (d.label as string) ?? 'Recurring bill',
      amount,
      cadence,
      source: 'declared',
    }
    const verdict = await flagAgainstBenchmark(
      supabase,
      { ...candidate, bill_subtype: resolvedSubtype },
      country,
    )
    items.push({
      ...candidate,
      monthly_equivalent: monthly,
      matched_detected: matchedSlot != null,
      superseded: false,
      benchmark_verdict: verdict,
      bill_subtype: resolvedSubtype,
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
    const classified = classifyBillSubtype(slot.label)
    const resolvedSubtype: BillSubtype | null = slot.bill_subtype ?? classified.subtype

    // Hold discretionary-but-regular detected spend out of the total. Only a
    // HIGH-confidence subtype rescues a discretionary category back to
    // committed — a low-confidence guess is too weak (the classifier's 'ee'
    // token matches "coffee", which must not force a coffee habit into the
    // fixed-cost total). resolvedSubtype is still used for the (dormant)
    // benchmark, where a wrong subtype is harmless until bands are sourced.
    const commitmentSubtype: BillSubtype | null =
      classified.confidence === 'high' ? classified.subtype : null
    if (
      classifyCommitment({ category_id: slot.category_id, bill_subtype: commitmentSubtype }) ===
      'variable'
    ) {
      variableRecurring.push({
        ...candidate,
        monthly_equivalent: slot.monthly_equivalent,
        matched_detected: false,
        superseded: false,
        benchmark_verdict: null,
        bill_subtype: null,
      })
      continue
    }

    const verdict = await flagAgainstBenchmark(
      supabase,
      { ...candidate, bill_subtype: resolvedSubtype },
      country,
    )
    items.push({
      ...candidate,
      monthly_equivalent: slot.monthly_equivalent,
      matched_detected: false,
      superseded: false,
      benchmark_verdict: verdict,
      bill_subtype: resolvedSubtype,
    })
  }

  const totalFixedCostsMonthly = items.reduce(
    (sum, item) => (item.superseded ? sum : sum + item.monthly_equivalent),
    0,
  )

  return {
    items,
    totalFixedCostsMonthly: Math.round(totalFixedCostsMonthly * 100) / 100,
    variableRecurring,
  }
}
