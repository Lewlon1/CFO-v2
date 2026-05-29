// Candidate-recurring tier — the loose pass that sits AROUND the strict
// detector. It surfaces clusters that fail the strict gate but still look like
// commitments (a metro pass billed twice, a court membership, a software
// subscription with a wobbly amount), so the confirm screen can ASK rather
// than silently bank €0. Candidates are computed on the fly and never written
// to recurring_expenses — they're promoted (to user_declared_fixed_costs) only
// when the user accepts one. That keeps the bills page and the recurring-
// overlap insight (which read recurring_expenses) untouched.
//
// The strict constants (MIN_OCCURRENCES, MAX_AMOUNT_CV, …) are deliberately
// NOT reused here — this is a separate, looser lens. The strict gate stays
// exactly as tuned.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import {
  groupRecurringClusters,
  qualifiesAsRecurring,
  coefficientOfVariation,
  monthlyEquivalent,
} from './recurring-detector'
import { classifyCommitment } from './fixed-cost-classify'
import { classifyBillSubtype } from './benchmark/classify-subtype'
import type { Cadence } from './reconcile-fixed-costs'
import type { BillSubtype } from './benchmark/types'

export type RecurringCandidate = {
  /** Normalised merchant name (matches the cluster key). */
  name: string
  /** Average per-occurrence amount (positive). */
  amount: number
  /** Detected cadence; 'monthly' when the cadence is irregular. */
  cadence: Cadence
  occurrences: number
  monthly_equivalent: number
  /** 'high' => near-identical amounts (UI default-counts these); 'low' => wobbly (default-skipped). */
  confidence: 'high' | 'low'
  bill_subtype: BillSubtype | null
}

const CAND_MIN_OCC = 2
// Identical-ish amount twice ⇒ high confidence (TMB €45.50, a court fee). The
// strict pass uses a looser 0.20 CV; candidates split high/low at 0.10 because
// the UI auto-counts high-confidence ones, so the bar for "auto-count" is higher.
const CAND_HIGH_AMOUNT_CV = 0.1

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Surface committed-looking clusters that fail the strict gate. A cluster is a
 * candidate when it: spans ≥2 months, has ≥2 occurrences, does NOT already pass
 * the strict gate (those are 'detected'), is NOT already claimed (counted or
 * user-dismissed), and is NOT discretionary (groceries/dining/shopping are
 * spend, never a fixed-cost candidate).
 *
 * The ≥2-month span mirrors the strict detector's own guard and stops a pair of
 * same-month charges from inferring a nonsense cadence (and a wild monthly
 * equivalent) off a single gap.
 */
export async function computeRecurringCandidates(
  supabase: SupabaseClient,
  userId: string,
): Promise<RecurringCandidate[]> {
  const clusters = await groupRecurringClusters(supabase, userId)

  // Names already accounted for must not resurface as candidates:
  // anything in recurring_expenses (detected / tracked / dismissed) and any
  // non-dismissed user declaration.
  const [claimedRecRes, claimedDeclRes] = await Promise.all([
    supabase.from('recurring_expenses').select('name, status').eq('user_id', userId),
    supabase.from('user_declared_fixed_costs').select('label, status').eq('user_id', userId),
  ])
  const claimedRec = (claimedRecRes.data ?? []) as Array<{ name: string }>
  const claimedDecl = (claimedDeclRes.data ?? []) as Array<{ label: string; status: string }>
  const claimed = new Set<string>([
    ...claimedRec.map((r) => normaliseMerchant(r.name)),
    ...claimedDecl.filter((d) => d.status !== 'dismissed').map((d) => normaliseMerchant(d.label)),
  ])

  const out: RecurringCandidate[] = []
  for (const c of clusters) {
    if (claimed.has(c.normName)) continue
    if (c.occurrences < CAND_MIN_OCC) continue
    if (c.months < 2) continue
    if (qualifiesAsRecurring(c.signals)) continue
    if (classifyCommitment({ category_id: c.latestCategoryId }) === 'variable') continue

    const cadence: Cadence = c.frequency === 'irregular' ? 'monthly' : (c.frequency as Cadence)
    out.push({
      name: c.normName,
      amount: round2(c.avgAmount),
      cadence,
      occurrences: c.occurrences,
      monthly_equivalent: round2(monthlyEquivalent(c.avgAmount, cadence)),
      confidence: coefficientOfVariation(c.amounts) <= CAND_HIGH_AMOUNT_CV ? 'high' : 'low',
      bill_subtype: classifyBillSubtype(c.normName).subtype,
    })
  }
  return out
}
