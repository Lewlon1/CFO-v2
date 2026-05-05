// Evening cluster detector — finds nights when the user racked up multiple
// charges at the same merchant in a short window. Headline use case: the
// "bar tab" pattern where 3-5+ charges hit the same pub/bar over a single
// session, sometimes spilling across midnight into the next calendar day.
//
// Two cluster shapes count, EITHER fires:
//   - Tight: ≥3 charges at the same merchant within 4h on a single day.
//   - Wide:  ≥5 charges at the same merchant across a 36h window
//            (catches NYE-into-next-day patterns where the same tab gets
//            split across two calendar dates by the bank's batch posting).
//
// Different from high-frequency (which counts visits over 90 days) and
// from time-pattern (which compares weekend vs weekday averages). This one
// is about *one specific night*.
//
// Bonus weight: Friday/Saturday clusters and clusters that span midnight
// — both signal "social night out" rather than "I went to the same place
// for breakfast and lunch."

import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import type { Evidence, TransactionRow, VerifiableClaim } from '@/lib/experiments/types'
import { currencySymbol } from '@/lib/experiments/observation-templates'
import { amountForms, countWord, dayName as dayNameFromIso, formatShortDate, titleCase } from './evidence-helpers'

const TIGHT_MIN_CHARGES = 3
const TIGHT_SPAN_MS = 4 * 60 * 60 * 1000
const WIDE_MIN_CHARGES = 5
const WIDE_SPAN_MS = 36 * 60 * 60 * 1000
const MIN_TOTAL = 20

export interface EveningClusterInput {
  transactions: TransactionRow[]
  currency: string
}

interface ClusterCandidate {
  merchant: string
  startDateIso: string           // ISO yyyy-mm-dd of the FIRST tx in the cluster
  count: number
  total: number
  txIds: string[]
  firstTs: number
  lastTs: number
  shape: 'tight' | 'wide'
  spansMidnight: boolean
  startDayOfWeek: number
}

export function detectEveningClusters({
  transactions,
  currency,
}: EveningClusterInput): Evidence[] {
  // Group by merchant only — wide clusters span calendar dates.
  type Entry = { ts: number; id: string; amount: number; date: string }
  const buckets = new Map<string, Entry[]>()

  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (tx.category === 'income' || tx.category === 'transfer') continue
    if (!tx.description) continue
    const merchant = normaliseMerchant(tx.description)
    if (!merchant) continue
    const ts = Date.parse(tx.date)
    if (Number.isNaN(ts)) continue
    const arr = buckets.get(merchant) ?? []
    arr.push({ ts, id: tx.id, amount: Math.abs(tx.amount), date: tx.date.slice(0, 10) })
    buckets.set(merchant, arr)
  }

  const candidates: ClusterCandidate[] = []

  for (const [merchantNorm, entries] of buckets) {
    if (entries.length < TIGHT_MIN_CHARGES) continue
    entries.sort((a, b) => a.ts - b.ts)

    // Sliding window: for each end index, find the largest contiguous group
    // ending here that fits within either span. Try TIGHT first (more common,
    // higher signal); fall through to WIDE.
    let bestTight: { start: number; end: number } | null = null
    let bestWide: { start: number; end: number } | null = null

    for (let r = 0; r < entries.length; r++) {
      // Tight window
      let lt = r
      while (lt > 0 && entries[r].ts - entries[lt - 1].ts <= TIGHT_SPAN_MS) lt--
      if (r - lt + 1 >= TIGHT_MIN_CHARGES) {
        if (!bestTight || (r - lt) > (bestTight.end - bestTight.start)) {
          bestTight = { start: lt, end: r }
        }
      }

      // Wide window (always check independently — wide may include windows
      // tighter than 36h but with more charges than the tight window admits)
      let lw = r
      while (lw > 0 && entries[r].ts - entries[lw - 1].ts <= WIDE_SPAN_MS) lw--
      if (r - lw + 1 >= WIDE_MIN_CHARGES) {
        if (!bestWide || (r - lw) > (bestWide.end - bestWide.start)) {
          bestWide = { start: lw, end: r }
        }
      }
    }

    // Choose whichever shape produces a cluster — tight is preferred when
    // both fire because tight = clearly one session.
    let chosen: { start: number; end: number; shape: 'tight' | 'wide' } | null = null
    if (bestTight) chosen = { ...bestTight, shape: 'tight' }
    else if (bestWide) chosen = { ...bestWide, shape: 'wide' }
    if (!chosen) continue

    const window = entries.slice(chosen.start, chosen.end + 1)
    const total = window.reduce((s, e) => s + e.amount, 0)
    if (total < MIN_TOTAL) continue

    const firstDate = window[0].date
    const lastDate = window[window.length - 1].date
    const spansMidnight = firstDate !== lastDate
    const startDow = new Date(firstDate + 'T00:00:00Z').getUTCDay()

    candidates.push({
      merchant: titleCase(merchantNorm),
      startDateIso: firstDate,
      count: window.length,
      total: Math.round(total * 100) / 100,
      txIds: window.map((w) => w.id),
      firstTs: window[0].ts,
      lastTs: window[window.length - 1].ts,
      shape: chosen.shape,
      spansMidnight,
      startDayOfWeek: startDow,
    })
  }

  if (candidates.length === 0) return []

  function score(c: ClusterCandidate): number {
    // Base: tight clusters score higher than wide for the same count
    // (concentration signal is stronger). Both saturate around 1.
    const concentration = c.shape === 'tight'
      ? Math.min(0.55 + (c.count - TIGHT_MIN_CHARGES) * 0.1, 0.85)
      : Math.min(0.5  + (c.count - WIDE_MIN_CHARGES)  * 0.07, 0.78)
    const fridaySat = c.startDayOfWeek === 5 || c.startDayOfWeek === 6 ? 0.1 : 0
    const midnight = c.spansMidnight ? 0.05 : 0
    return Math.min(concentration + fridaySat + midnight, 1)
  }

  candidates.sort((a, b) => score(b) - score(a))
  const top = candidates[0]

  const symbol = currencySymbol(currency)
  const spanHours = Math.max(1, Math.round((top.lastTs - top.firstTs) / (60 * 60 * 1000)))
  const day = dayNameFromIso(top.startDateIso)
  const formattedDate = formatShortDate(top.startDateIso)

  const claims: VerifiableClaim[] = [
    {
      kind: 'merchant',
      value: top.merchant,
      alt_forms: [top.merchant.toLowerCase(), top.merchant.toUpperCase()],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'count',
      value: top.count,
      alt_forms: [String(top.count), countWord(top.count)],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'amount',
      value: top.total,
      alt_forms: amountForms(top.total, symbol),
      source_tx_ids: top.txIds,
    },
    {
      kind: 'duration',
      value: spanHours,
      alt_forms: [`${spanHours}`, `${spanHours} hours`, `${spanHours}h`],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'date',
      value: formattedDate,
      alt_forms: [top.startDateIso, formattedDate.toLowerCase(), day, day.toLowerCase()],
      source_tx_ids: top.txIds,
    },
  ]

  const wow_score = score(top)

  // Brief leans into interpretation. The author prompt picks this up and the
  // synthesised fallback uses it directly when validation rejects.
  const span = top.spansMidnight ? `${day} into the next morning` : `${day} ${formattedDate}`
  const brief = `On ${span}, ${top.count} separate charges at ${top.merchant} in roughly ${spanHours} hours — ${symbol}${top.total} total. The kind of night that captures itself across multiple taps. Worth noticing as a pattern of *how* you spend, not whether you should.`

  return [
    {
      source: 'evening_cluster',
      evidence_id: `evening_cluster:${top.merchant.toLowerCase()}:${top.startDateIso}`,
      headline: `${top.count} charges at ${top.merchant} in ${spanHours}h on ${day} ${formattedDate} — ${symbol}${top.total} total.`,
      wow_score,
      verifiable_claims: claims,
      context_facts: {
        day_of_week: day,
        span_hours: spanHours,
        spans_midnight: top.spansMidnight ? 'yes' : 'no',
      },
      brief,
      legacy_observation_type: 'time_pattern',
    },
  ]
}
