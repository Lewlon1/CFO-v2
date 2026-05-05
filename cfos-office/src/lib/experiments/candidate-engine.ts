// Wow Moment v3 candidate engine. Composes the federated evidence pool from:
//   - new analytics detectors (duplicate-charge, evening-cluster, foreign-fee,
//     big-ticket)
//   - the v2 detector pool (high-freq-merchant, category-variance, time-pattern)
//   - gap-analyser (Value Map vs actual contradictions)
//   - comparative-scale enricher attaches user-scale context to the chosen
//     evidence so Opus can write "X% of monthly spend" / "≈ N weeks of
//     groceries" naturally.
//
// Lifetime guard: kept from v2. If ANY active_experiments row exists for the
// user, returns null (the route renders an honest fallback).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DataDepth, Evidence, TransactionRow } from './types'
import {
  gapsToEvidences,
  holidayClustersToEvidences,
  legacyDetectorEvidences,
  recurringOverlapToEvidences,
} from './evidence-adapter'
import { detectDuplicateCharges } from '@/lib/analytics/duplicate-charge-detector'
import { detectEveningClusters } from '@/lib/analytics/evening-cluster-detector'
import { detectForeignFees } from '@/lib/analytics/foreign-fee-aggregator'
import { detectBigTicketSurprise } from '@/lib/analytics/big-ticket-surprise-detector'
import { detectCashTransfers } from '@/lib/analytics/cash-transfer-detector'
import { enrichWithComparators, type UserScaleContext } from '@/lib/analytics/comparative-scale'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

const TRANSACTION_WINDOW_DAYS = 90
const MIN_TRANSACTIONS_FOR_TIER12 = 30 // matches v2 — below this we honest-tease
const DEFAULT_CURRENCY = 'GBP'

export interface EvidencePoolResult {
  pool: Evidence[]
  dataDepth: DataDepth
  hasPriorExperiment: boolean
  context: {
    archetype: string | null
    currency: string
    country: string | null
    display_name: string | null
    certainty_areas: string[]
    conflict_areas: string[]
  }
  scaleContext: UserScaleContext
}

export async function composeEvidencePool(
  userId: string,
  supabase: SupabaseClient,
): Promise<EvidencePoolResult> {
  // 0. Lifetime guard: any prior active_experiments row blocks generation.
  const priorCheck = await supabase
    .from('active_experiments')
    .select('id')
    .eq('user_id', userId)
    .limit(1)

  const hasPriorExperiment = (priorCheck.data?.length ?? 0) > 0

  // 1. Fetch transactions in the 90-day window.
  const since = new Date(Date.now() - TRANSACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const txResult = await supabase
    .from('transactions')
    .select('id, date, description, amount, category_id, value_category, is_recurring')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', since)
    .limit(2000)
  const rawTransactions = txResult.data ?? []

  // 2. Resolve user profile + archetype + Value Map session.
  const [profileResult, vmResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('primary_currency, country, display_name')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('value_map_sessions')
      .select('archetype_name, certainty_areas, conflict_areas')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const currency = profileResult.data?.primary_currency ?? DEFAULT_CURRENCY
  const country = profileResult.data?.country ?? null
  const display_name = profileResult.data?.display_name ?? null
  const archetype = vmResult.data?.archetype_name ?? null
  const certainty_areas = parseStringArray(vmResult.data?.certainty_areas)
  const conflict_areas = parseStringArray(vmResult.data?.conflict_areas)

  // 3. Resolve category names for the legacy detectors that need them.
  const categoryIds = Array.from(
    new Set(rawTransactions.map((r) => r.category_id).filter((v): v is string => Boolean(v))),
  )
  const categoryNameById = new Map<string, string>()
  if (categoryIds.length > 0) {
    const catResult = await supabase
      .from('categories')
      .select('id, name')
      .in('id', categoryIds)
    for (const cat of catResult.data ?? []) {
      if (cat.id && cat.name) categoryNameById.set(cat.id, String(cat.name).toLowerCase())
    }
  }

  const transactions: TransactionRow[] = rawTransactions.map((row) => ({
    id: row.id,
    date: row.date,
    description: row.description ?? '',
    amount: Number(row.amount),
    category: row.category_id ? categoryNameById.get(row.category_id) ?? null : null,
    value_category: row.value_category ?? null,
  }))

  // 4. Build a STRICT recurring-merchants set used only for detector
  //    exclusion. The DB's `is_recurring` flag is over-eager — it can flag
  //    8 ad-hoc cash transfers with identical descriptions as recurring
  //    even though they have no real periodicity. The strict set requires
  //    BOTH ≥3 occurrences AND inter-tx gap stdev < 7 days (true cadence).
  //    We don't touch `recurring-detector.ts` itself — that has wider
  //    consumers; this is a local correction for the wow pipeline only.
  const strictRecurring = buildStrictRecurringSet(rawTransactions)

  // 5. DataDepth — used by tier-classifier.
  const dataDepth = computeDataDepth(transactions)

  // 6. If the lifetime guard fired or we have insufficient transactions, the
  //    route still wants the dataDepth + context to render an honest fallback.
  //    Skip detector work to save time.
  if (hasPriorExperiment || transactions.length < MIN_TRANSACTIONS_FOR_TIER12) {
    return {
      pool: [],
      dataDepth,
      hasPriorExperiment,
      context: { archetype, currency, country, display_name, certainty_areas, conflict_areas },
      scaleContext: emptyScaleContext(currency),
    }
  }

  // 7. Run new detectors + legacy detectors + gap analysis in parallel.
  const detectorInput = { transactions, archetype, currency, country }
  const [
    duplicates,
    evenings,
    foreignFees,
    bigTickets,
    cashTransfers,
    legacy,
    gaps,
    holidays,
    recurringOverlaps,
  ] = await Promise.all([
    Promise.resolve(detectDuplicateCharges({ transactions, recurringMerchants: strictRecurring, currency })),
    Promise.resolve(detectEveningClusters({ transactions, currency })),
    Promise.resolve(detectForeignFees({ transactions, currency })),
    Promise.resolve(detectBigTicketSurprise({ transactions, recurringMerchants: strictRecurring, currency })),
    Promise.resolve(detectCashTransfers({ transactions, currency })),
    legacyDetectorEvidences(detectorInput),
    gapsToEvidences(supabase, userId, currency),
    holidayClustersToEvidences(supabase, userId, currency),
    recurringOverlapToEvidences(supabase, userId, currency),
  ])

  let pool: Evidence[] = [
    ...duplicates,
    ...evenings,
    ...foreignFees,
    ...bigTickets,
    ...cashTransfers,
    ...holidays,
    ...recurringOverlaps,
    ...gaps,
    ...legacy,
  ]

  // 8. Build the user-scale context for comparators (median expense, monthly
  //    spend, etc.) — pulls from the in-memory transactions so we don't make
  //    extra DB calls.
  const scaleContext = buildScaleContext(transactions, currency)

  // 9. Enrich each evidence with comparators. The validator allows the new
  //    comparator numbers automatically because they get added as claims.
  pool = pool.map((ev) => enrichWithComparators(ev, scaleContext))

  // 10. Auto-inject window-duration claims on every evidence. Without this,
  //     Opus naturally writes "in 90 days" / "for three months" and trips
  //     the validator because 90 / 30 are not in the evidence's payload.
  //     Adding them once here lets every evidence inherit the language of
  //     the window without per-detector duplication.
  pool = pool.map((ev) => ({
    ...ev,
    verifiable_claims: [
      ...ev.verifiable_claims,
      { kind: 'duration', value: 90, alt_forms: ['90', '90 days', '3 months', 'three months'] },
      { kind: 'duration', value: 30, alt_forms: ['30', '30 days', 'a month'] },
      ...(dataDepth.days > 0
        ? [{ kind: 'duration' as const, value: dataDepth.days, alt_forms: [String(dataDepth.days), `${dataDepth.days} days`] }]
        : []),
    ],
  }))

  return {
    pool,
    dataDepth,
    hasPriorExperiment,
    context: { archetype, currency, country, display_name, certainty_areas, conflict_areas },
    scaleContext,
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function computeDataDepth(transactions: TransactionRow[]): DataDepth {
  if (transactions.length === 0) {
    return { days: 0, txCount: 0, categorisedShare: 0 }
  }
  const dates = transactions.map((t) => Date.parse(t.date)).filter((n) => !Number.isNaN(n))
  if (dates.length === 0) return { days: 0, txCount: transactions.length, categorisedShare: 0 }
  const span = (Math.max(...dates) - Math.min(...dates)) / (24 * 60 * 60 * 1000)
  const categorised = transactions.filter((t) => t.category !== null).length
  return {
    days: Math.max(0, Math.round(span)),
    txCount: transactions.length,
    categorisedShare: categorised / transactions.length,
  }
}

function buildScaleContext(transactions: TransactionRow[], currency: string): UserScaleContext {
  // Approximate monthly income from positive entries (deposits), monthly
  // spend from negatives, and weekly grocery spend from category 'groceries'.
  // These are best-effort — comparative-scale gracefully omits whichever
  // comparator is null.
  let positive = 0
  let negative = 0
  let groceriesTotal = 0
  let groceriesCount = 0
  let earliest = Infinity
  let latest = -Infinity

  for (const tx of transactions) {
    const ts = Date.parse(tx.date)
    if (!Number.isNaN(ts)) {
      if (ts < earliest) earliest = ts
      if (ts > latest) latest = ts
    }
    if (tx.amount >= 0) {
      positive += tx.amount
    } else {
      negative += Math.abs(tx.amount)
      if (tx.category === 'groceries') {
        groceriesTotal += Math.abs(tx.amount)
        groceriesCount += 1
      }
    }
  }

  const days = Number.isFinite(earliest) && Number.isFinite(latest)
    ? Math.max(1, (latest - earliest) / (24 * 60 * 60 * 1000))
    : 30
  const months = Math.max(1, days / 30)
  const weeks = Math.max(1, days / 7)

  return {
    monthlyIncome: positive > 0 ? Math.round(positive / months) : null,
    monthlySpend: negative > 0 ? Math.round(negative / months) : null,
    rent: null, // resolved separately when recurring_expenses surfaces a rent row
    weeklyGroceries: groceriesCount >= 4 ? Math.round(groceriesTotal / weeks) : null,
    currency,
  }
}

function emptyScaleContext(currency: string): UserScaleContext {
  return { monthlyIncome: null, monthlySpend: null, rent: null, weeklyGroceries: null, currency }
}

// Stricter recurring detection used ONLY for detector exclusion in the wow
// pipeline. Real recurring expenses have similar inter-transaction gaps —
// e.g. monthly rent ≈ 30 days apart. Identical-description cash transfers
// have wildly varying gaps and shouldn't be excluded from big-ticket /
// duplicate / foreign-fee detectors as if they were rent.
//
// Uses the gap stdev as a periodicity proxy: stdev < 7 days = real cadence.
function buildStrictRecurringSet(
  rawTransactions: Array<{ description: string | null; date: string; is_recurring?: boolean | null }>,
): Set<string> {
  const groups = new Map<string, number[]>() // normalised merchant → sorted timestamps
  for (const row of rawTransactions) {
    if (!row.description) continue
    const merchant = normaliseMerchant(row.description)
    if (!merchant) continue
    const ts = Date.parse(row.date)
    if (Number.isNaN(ts)) continue
    const arr = groups.get(merchant) ?? []
    arr.push(ts)
    groups.set(merchant, arr)
  }

  const recurring = new Set<string>()
  const DAY_MS = 24 * 60 * 60 * 1000
  for (const [merchant, ts] of groups) {
    if (ts.length < 3) continue
    ts.sort((a, b) => a - b)
    const gaps: number[] = []
    for (let i = 1; i < ts.length; i++) {
      gaps.push((ts[i] - ts[i - 1]) / DAY_MS)
    }
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length
    const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length
    const stdev = Math.sqrt(variance)
    if (stdev < 7 && mean >= 5) recurring.add(merchant)
  }
  return recurring
}

function parseStringArray(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string')
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }
  return []
}
