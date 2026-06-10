// VM-3 — deterministic candidate selection for the post-Read Value Map
// card session. VM-5 (pulse cadence) will reuse this module.
//
// Where select-cards.ts optimises the value-first card set for DIVERGENCE
// (where a sort is most likely to contradict probable intent, seeded by the
// First Read's hook teasers), this selector optimises for CALIBRATION value:
// the merchants where the system knows least (low value confidence) and the
// money is largest and most habitual — i.e. where one honest answer moves the
// most monthly spend onto the user's own value labels.
//
// Fully deterministic — same inputs, same cards. Zero LLM involvement.
// Windows relative to the latest transaction date, never Date.now() (the
// dormancy-vs-today lesson documented in select-cards.ts).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MIN_VIABLE_CANDIDATES,
  ONBOARDING_CARD_COUNT,
  RULE_APPLICATION_MIN_CONFIDENCE,
} from '@/lib/categorisation/value-config'
import { EXCLUDED_FROM_PL_PG_LIST } from '@/lib/analytics/categories'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { getDataWindowEnd } from '@/lib/analytics/cluster-behaviour/queries'
import { windowSince } from './select-cards'
import type { ValueMapTransaction } from './types'

/** Hard range guard on the served card count — selection never serves more
 *  than 12 even if asked, and only dips below 8 when availability forces it
 *  (down to MIN_VIABLE_CANDIDATES, below which the flow defers entirely). */
export const CARD_COUNT_MIN = 8
export const CARD_COUNT_MAX = 12

/** Multiplier applied to a merchant's score when its spend recurs. A habitual
 *  merchant is where a value call keeps paying off month after month. */
export const RECURRENCE_BOOST = 1.25

/** Days of history (relative to the data window end) considered. */
export const CANDIDATE_WINDOW_DAYS = 90

/** Diversity cap — at most this many cards from any one traditional category,
 *  so the session isn't 8 questions about groceries. */
export const MAX_CARDS_PER_CATEGORY = 3

export interface VmCandidate {
  merchantClean: string
  exemplarTxnId: string
  monthlySpend: number
  recurring: boolean
  currentConfidence: number
  categoryId: string | null
  score: number
}

/** Minimal transaction row the pure selection core operates on. */
export interface CandidateTxnRow {
  id: string
  description: string | null
  amount: number
  date: string
  is_recurring: boolean | null
  category_id: string | null
  value_confidence: number | null
  value_confirmed_by_user: boolean | null
}

export type CandidateSelection =
  | { ok: true; candidates: VmCandidate[] }
  | {
      ok: false
      reason: 'no_spend' | 'below_min_viable'
      /** How many viable merchants existed (for logging / chat-offer copy). */
      viableCount: number
    }

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/**
 * Pure selection core — no I/O, exported for unit tests.
 *
 * score = normalisedMonthlySpend × recurrenceBoost × (1 − currentValueConfidence)
 *
 * Exclusions (callers supply the sets; the IO wrapper builds them):
 * - merchants with any user-confirmed transaction
 * - merchants covered by a merchant rule at ≥ RULE_APPLICATION_MIN_CONFIDENCE
 *   (sub-floor rules are "still learning" — asking is still worthwhile)
 * - income / transfer / debt / savings rows never reach this function
 *   (filtered in the IO query)
 *
 * Constraints: one card per merchant_clean; ≤ MAX_CARDS_PER_CATEGORY per
 * traditional category. `seedMerchants` (e.g. the First Read's hook merchants,
 * already promised to the user) are placed first when they survive exclusions.
 *
 * Returns ok:false when fewer than MIN_VIABLE_CANDIDATES merchants survive.
 */
export function chooseCandidates(
  rows: CandidateTxnRow[],
  excludedMerchants: ReadonlySet<string>,
  n: number = ONBOARDING_CARD_COUNT,
  seedMerchants: string[] = [],
): CandidateSelection {
  const target = Math.min(CARD_COUNT_MAX, Math.max(CARD_COUNT_MIN, Math.round(n)))

  type Roll = {
    spend: number
    txns: CandidateTxnRow[]
    recurring: boolean
    maxConfidence: number
    confirmed: boolean
    categoryCounts: Map<string, number>
  }
  const rolled = new Map<string, Roll>()
  const months = new Set<string>()

  for (const row of rows) {
    if (Number(row.amount) >= 0) continue // outflow only
    const key = normaliseMerchant(row.description ?? '')
    if (!key) continue
    months.add(String(row.date).slice(0, 7))
    const spend = Math.abs(Number(row.amount))
    const existing = rolled.get(key)
    if (existing) {
      existing.spend += spend
      existing.txns.push(row)
      existing.recurring = existing.recurring || Boolean(row.is_recurring)
      existing.maxConfidence = Math.max(existing.maxConfidence, Number(row.value_confidence ?? 0))
      existing.confirmed = existing.confirmed || Boolean(row.value_confirmed_by_user)
      if (row.category_id) {
        existing.categoryCounts.set(
          row.category_id,
          (existing.categoryCounts.get(row.category_id) ?? 0) + 1,
        )
      }
    } else {
      rolled.set(key, {
        spend,
        txns: [row],
        recurring: Boolean(row.is_recurring),
        maxConfidence: Number(row.value_confidence ?? 0),
        confirmed: Boolean(row.value_confirmed_by_user),
        categoryCounts: new Map(row.category_id ? [[row.category_id, 1]] : []),
      })
    }
  }

  if (rolled.size === 0) return { ok: false, reason: 'no_spend', viableCount: 0 }

  // monthlySpend = windowed spend / distinct data months in the window (≥1).
  const monthCount = Math.max(1, months.size)

  // Build viable candidates (exclusions applied).
  const viable: VmCandidate[] = []
  let maxMonthlySpend = 0
  for (const [key, roll] of rolled) {
    if (roll.confirmed) continue
    if (excludedMerchants.has(key)) continue
    const monthlySpend = roll.spend / monthCount
    maxMonthlySpend = Math.max(maxMonthlySpend, monthlySpend)
    viable.push({
      merchantClean: key,
      exemplarTxnId: pickExemplar(roll.txns).id,
      monthlySpend,
      recurring: roll.recurring,
      currentConfidence: clamp01(roll.maxConfidence),
      categoryId: pickDominantCategory(roll.categoryCounts),
      score: 0, // filled below once maxMonthlySpend is known
    })
  }

  if (viable.length < MIN_VIABLE_CANDIDATES) {
    return { ok: false, reason: 'below_min_viable', viableCount: viable.length }
  }

  for (const c of viable) {
    const normalisedSpend = maxMonthlySpend > 0 ? c.monthlySpend / maxMonthlySpend : 0
    c.score =
      normalisedSpend * (c.recurring ? RECURRENCE_BOOST : 1) * (1 - c.currentConfidence)
  }

  // Deterministic order: score desc, merchant key asc as the stable tiebreak.
  viable.sort(
    (a, b) => b.score - a.score || a.merchantClean.localeCompare(b.merchantClean),
  )

  const byKey = new Map(viable.map((c) => [c.merchantClean, c]))
  const selected: VmCandidate[] = []
  const perCategory = new Map<string, number>()

  const tryAdd = (c: VmCandidate): boolean => {
    if (selected.length >= target) return false
    const cat = c.categoryId ?? 'uncategorised'
    if ((perCategory.get(cat) ?? 0) >= MAX_CARDS_PER_CATEGORY) return false
    selected.push(c)
    perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1)
    return true
  }

  // 1. Seeds first (hook merchants promised to the user), deduped.
  const seeded = new Set<string>()
  for (const raw of seedMerchants) {
    const key = normaliseMerchant(raw)
    if (!key || seeded.has(key)) continue
    seeded.add(key)
    const c = byKey.get(key)
    if (c) tryAdd(c)
  }

  // 2. Fill by score.
  for (const c of viable) {
    if (selected.length >= target) break
    if (seeded.has(c.merchantClean) && selected.includes(c)) continue
    if (!selected.includes(c)) tryAdd(c)
  }

  return { ok: true, candidates: selected }
}

/** Exemplar = the lowest-confidence transaction; most recent breaks ties. */
function pickExemplar(txns: CandidateTxnRow[]): CandidateTxnRow {
  return [...txns].sort((a, b) => {
    const confA = Number(a.value_confidence ?? 0)
    const confB = Number(b.value_confidence ?? 0)
    if (confA !== confB) return confA - confB
    return String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id)
  })[0]
}

function pickDominantCategory(counts: Map<string, number>): string | null {
  let top: string | null = null
  let max = 0
  for (const [id, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > max) {
      max = c
      top = id
    }
  }
  return top
}

/**
 * Merchants already settled and therefore never re-served as cards. Mirrors
 * the spirit of fetchClassifiedMerchants (get-value-review-queue.ts) but
 * applies the RULE_APPLICATION_MIN_CONFIDENCE floor: a sub-floor rule is
 * still learning, so its merchant remains a legitimate card. Confirmed-txn
 * merchants are fetched across ALL history (a confirmation older than the
 * candidate window still settles the merchant); windowed confirmed rows are
 * additionally caught inside chooseCandidates.
 */
async function fetchSettledMerchants(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const [rulesRes, confirmedRes] = await Promise.all([
    supabase
      .from('value_category_rules')
      .select('match_value, confidence')
      .eq('user_id', userId)
      .in('match_type', ['merchant', 'merchant_time', 'merchant_amount'])
      .gte('confidence', RULE_APPLICATION_MIN_CONFIDENCE),
    supabase
      .from('transactions')
      .select('description')
      .eq('user_id', userId)
      .eq('value_confirmed_by_user', true)
      .limit(2000),
  ])
  const out = new Set<string>()
  for (const row of (rulesRes.data ?? []) as Array<{ match_value: string | null }>) {
    const key = (row.match_value ?? '').toLowerCase()
    if (key) out.add(key)
  }
  for (const row of (confirmedRes.data ?? []) as Array<{ description: string | null }>) {
    const key = normaliseMerchant(row.description ?? '')
    if (key) out.add(key)
  }
  return out
}

/**
 * IO wrapper: fetch the user's windowed outflow transactions (income,
 * transfers, debt repayments and savings moves excluded at the query), build
 * the exclusion set, and run the pure core.
 */
export async function selectValueMapCandidates(
  supabase: SupabaseClient,
  userId: string,
  n: number = ONBOARDING_CARD_COUNT,
  opts?: { seedMerchants?: string[] },
): Promise<CandidateSelection> {
  const windowEnd = await getDataWindowEnd(supabase, userId)
  const since = windowSince(windowEnd, CANDIDATE_WINDOW_DAYS)
  const endStr = windowEnd ?? new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, description, amount, date, is_recurring, category_id, value_confidence, value_confirmed_by_user',
    )
    .eq('user_id', userId)
    .is('deleted_at', null)
    .lt('amount', 0)
    .gte('date', since)
    .lte('date', endStr)
    .or(`category_id.is.null,category_id.not.in.${EXCLUDED_FROM_PL_PG_LIST}`)
    .order('date', { ascending: false })
    .limit(2000)

  if (error) {
    console.error('[select-candidates] transaction query failed:', error)
    return { ok: false, reason: 'no_spend', viableCount: 0 }
  }

  const excluded = await fetchSettledMerchants(supabase, userId)
  const selection = chooseCandidates(
    (data ?? []) as CandidateTxnRow[],
    excluded,
    n,
    opts?.seedMerchants ?? [],
  )
  if (!selection.ok) {
    console.warn('[select-candidates] deferring card session:', {
      userId,
      reason: selection.reason,
      viableCount: selection.viableCount,
    })
  }
  return selection
}

/**
 * Materialise candidates as ValueMapTransaction cards (one query by exemplar
 * id). Card context carries the merchant's monthly spend — money numbers are
 * allowed on cards; timing telemetry is not.
 */
export async function materialiseCandidateCards(
  supabase: SupabaseClient,
  candidates: VmCandidate[],
  currency: string,
): Promise<ValueMapTransaction[]> {
  if (candidates.length === 0) return []
  const ids = candidates.map((c) => c.exemplarTxnId)
  const { data } = await supabase
    .from('transactions')
    .select('id, description, amount, date, is_recurring, category_id, currency')
    .in('id', ids)
  const byId = new Map(((data ?? []) as Array<Record<string, unknown>>).map((t) => [t.id as string, t]))

  const cards: ValueMapTransaction[] = []
  for (const c of candidates) {
    const t = byId.get(c.exemplarTxnId)
    if (!t) continue
    cards.push({
      id: t.id as string,
      merchant: c.merchantClean,
      description: (t.description as string | null) ?? c.merchantClean,
      amount: Math.abs(Number(t.amount)),
      currency: (t.currency as string | null) ?? currency,
      transaction_date: t.date as string,
      is_recurring: Boolean(t.is_recurring),
      category_id: (t.category_id as string | null) ?? null,
      context: c.recurring ? 'Recurring' : undefined,
    })
  }
  return cards
}
