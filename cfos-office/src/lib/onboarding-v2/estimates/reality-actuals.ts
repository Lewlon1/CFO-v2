// OB-3 — actuals fetcher for the estimate-vs-reality comparison.
//
// computeDeltas (deltas.ts) is PURE over pre-fetched actuals; this is the impure
// half — it reads the user's real transactions, recurring set, and fixed-cost
// reconcile and reduces them to the five BandActuals the engine compares against
// the pinned band midpoints. "The LLM interprets, the system computes": every
// number here is computed deterministically, never by the model.
//
// Honest unverifiability: a band the upload can't isolate is returned as null,
// and computeDeltas surfaces it as a still-an-estimate band rather than a false
// verified figure. Two deliberate nulls:
//   · housing — only verified when user_profiles.monthly_rent is on file (the
//     reconcile's only housing source). Estimate-first users never typed a rent
//     number, so housing usually stays an estimate.
//   · bills — only verified when housing is known (so "fixed total − housing"
//     actually isolates bills) AND a positive remainder exists. With housing
//     unknown the remainder would silently fold in any detected rent, so we keep
//     bills an estimate rather than risk a rent figure masquerading as a bills
//     delta on the user's first real read — trust on first impression is the
//     whole point of this mission.

import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileFixedCosts, normaliseCadence } from '@/lib/analytics/reconcile-fixed-costs'
import { monthlyEquivalent } from '@/lib/analytics/recurring-detector'
import { isPlSpend, absExpense } from '@/lib/analytics/pattern-detectors'
import {
  getDataWindowEnd,
  getDataWindowCoverage,
} from '@/lib/analytics/cluster-behaviour/queries'
import type { BandActuals } from './deltas'

const WINDOW_DAYS = 90
const DAYS_PER_MONTH = 30.44
/** category_id of eating/drinking out (categories.ts). */
const EAT_OUT_CATEGORY = 'eat_drinking_out'
/** category_id for savings/investment transfers (categories.ts, NEUTRAL). */
const SAVINGS_CATEGORY = 'savings_investments'
/** bill_subtype that marks a detected streaming subscription (benchmark/types). */
const SUBSCRIPTION_SUBTYPE = 'streaming_subscription'

const round = (n: number) => Math.round(n)

/**
 * Fetch the five BandActuals from the user's real data for the reality-check
 * Read. Read-only. Pass the SERVICE client (the reality-check route already
 * holds one) so reconcile + transaction reads aren't gated by per-request RLS
 * quirks on assistant-side composition.
 */
export async function fetchBandActuals(
  supabase: SupabaseClient,
  userId: string,
): Promise<BandActuals> {
  const dataWindowEnd = await getDataWindowEnd(supabase, userId)
  const coverage = await getDataWindowCoverage(supabase, userId, WINDOW_DAYS, dataWindowEnd)
  const effectiveMonths = Math.max(1, coverage.coveredDays / DAYS_PER_MONTH)

  // Income + housing from the profile (the canonical rent source).
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('monthly_rent, net_monthly_income')
    .eq('id', userId)
    .maybeSingle()
  const monthlyRent =
    typeof profile?.monthly_rent === 'number' && profile.monthly_rent > 0
      ? profile.monthly_rent
      : null
  const income =
    typeof profile?.net_monthly_income === 'number' && profile.net_monthly_income > 0
      ? profile.net_monthly_income
      : null

  // Fixed-cost reconcile → committed monthly total (housing + bills + committed
  // recurring). Housing falls back to the reconcile's rent-sourced item.
  let totalFixed = 0
  let reconciledHousing: number | null = null
  try {
    const reconciled = await reconcileFixedCosts(supabase, userId)
    totalFixed = reconciled.totalFixedCostsMonthly
    const housingItem = reconciled.items.find((i) => i.source === 'rent' && !i.superseded)
    reconciledHousing = housingItem ? housingItem.monthly_equivalent : null
  } catch (err) {
    console.error('[reality-actuals] reconcileFixedCosts failed:', err)
  }
  const housing = monthlyRent ?? reconciledHousing

  // Bills = the committed total beyond housing — but only when housing is known
  // (see the file header: an unknown housing would let detected rent leak in).
  let bills: number | null = null
  if (housing != null) {
    const nonHousing = totalFixed - housing
    bills = nonHousing > 0 ? round(nonHousing) : null
  }

  // Subscriptions = monthly total of detected streaming subscriptions. The only
  // schema-backed "subscription" signal; a single-month upload rarely clears the
  // detector's ≥3-occurrence gate, so this is often null (→ stays an estimate).
  const { data: recurring } = await supabase
    .from('recurring_expenses')
    .select('amount, frequency, bill_subtype')
    .eq('user_id', userId)
    .in('status', ['detected', 'tracked'])
  const subRows = (recurring ?? []).filter(
    (r) => (r.bill_subtype as string | null) === SUBSCRIPTION_SUBTYPE,
  )
  const subscriptions =
    subRows.length > 0
      ? round(
          subRows.reduce(
            // normaliseCadence maps variant spellings ('bimonthly', 'yearly',
            // 'fortnightly') onto the canonical ladder before monthlyEquivalent —
            // without it those fall through to the default case and the monthly
            // total is overstated (the reconcile applies the same normalisation).
            (sum, r) =>
              sum + monthlyEquivalent(Math.abs(Number(r.amount)), normaliseCadence(r.frequency as string)),
            0,
          ),
        )
      : null

  // One transaction pass over the window for the behavioural actuals: eating-out
  // monthly, savings-transfer monthly, and total tracked spend (the save-reach
  // proxy denominator).
  const endStr = dataWindowEnd ?? new Date().toISOString().slice(0, 10)
  const since = new Date(new Date(endStr).getTime() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const { data: txns } = await supabase
    .from('transactions')
    .select('amount, category_id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', since)
    .lte('date', endStr)

  let foodOutTotal = 0
  let hasFoodOut = false
  let savingsOutTotal = 0
  let hasSavingsOut = false
  let trackedSpendTotal = 0
  for (const t of txns ?? []) {
    const amt = Number(t.amount)
    const cat = (t.category_id as string | null) ?? null
    if (cat === EAT_OUT_CATEGORY && amt < 0) {
      foodOutTotal += -amt
      hasFoodOut = true
    }
    if (cat === SAVINGS_CATEGORY && amt < 0) {
      savingsOutTotal += -amt
      hasSavingsOut = true
    }
    if (isPlSpend({ amount: amt, category_id: cat })) {
      trackedSpendTotal += absExpense(amt)
    }
  }

  const foodOut = hasFoodOut ? round(foodOutTotal / effectiveMonths) : null

  // Save reach: detected savings transfers first (real money set aside); else
  // the income-minus-tracked-spend leftover proxy (flagged so the Read quotes
  // SAVE_REACH_PROXY_NOTE). Clamp the proxy at 0 — "what was left over" can't be
  // negative, and a deficit month would otherwise read as a nonsensical figure.
  let saveReach: number | null = null
  let saveReachIsProxy = false
  if (hasSavingsOut && savingsOutTotal > 0) {
    saveReach = round(savingsOutTotal / effectiveMonths)
  } else if (income != null) {
    saveReach = Math.max(0, round(income - trackedSpendTotal / effectiveMonths))
    saveReachIsProxy = true
  }

  return {
    housing: housing != null ? round(housing) : null,
    subscriptions,
    bills,
    foodOut,
    saveReach,
    saveReachIsProxy,
  }
}
