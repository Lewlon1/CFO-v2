// Duplicate charge detector — finds the same merchant + same |amount| on the
// same day (or ±1 day). The headline use case is double-billing, e.g. an
// airline charging twice for the same booking. Highest wow_score in the pool
// because the action is both clear (dispute it) and emotionally charged
// (free money back).
//
// Excludes recurring transactions (utilities/subscriptions can have repeated
// equal amounts on different days legitimately) and very small amounts
// (€20 floor — duplicate cafe charges are noise).

import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import type { Evidence, TransactionRow, VerifiableClaim } from '@/lib/experiments/types'
import { currencySymbol } from '@/lib/experiments/observation-templates'
import { amountForms, countWord, formatShortDate, titleCase } from './evidence-helpers'

const MIN_AMOUNT = 20
const AMOUNT_TOLERANCE_CENTS = 1
const DAY_TOLERANCE_MS = 24 * 60 * 60 * 1000 // ±1 day

export interface DuplicateChargeInput {
  transactions: TransactionRow[]
  recurringMerchants?: Set<string> // normalised names of known-recurring merchants to exclude
  currency: string
}

interface DuplicateGroup {
  merchant: string         // display name, title-cased
  amount: number           // canonical absolute amount
  date: string             // ISO date (yyyy-mm-dd) of first charge
  txIds: string[]
  count: number
}

export function detectDuplicateCharges({
  transactions,
  recurringMerchants,
  currency,
}: DuplicateChargeInput): Evidence[] {
  // Bucket by (normalised merchant, rounded amount) → list of {date, id}
  type Entry = { date: string; ts: number; id: string; amount: number; description: string }
  const buckets = new Map<string, Entry[]>()

  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    const abs = Math.abs(tx.amount)
    if (abs < MIN_AMOUNT) continue
    if (!tx.description) continue
    const key = normaliseMerchant(tx.description)
    if (!key) continue
    if (recurringMerchants?.has(key)) continue

    const ts = Date.parse(tx.date)
    if (Number.isNaN(ts)) continue

    // Group key combines merchant + cents-rounded amount so €485.58 ×2 buckets
    // together but €485.58 vs €485.59 don't (within tolerance handled below).
    const bucketKey = `${key}|${Math.round(abs * 100)}`
    const arr = buckets.get(bucketKey) ?? []
    arr.push({ date: tx.date.slice(0, 10), ts, id: tx.id, amount: abs, description: tx.description })
    buckets.set(bucketKey, arr)
  }

  const groups: DuplicateGroup[] = []

  for (const entries of buckets.values()) {
    if (entries.length < 2) continue
    // Sort by timestamp so we can find pairs within tolerance.
    entries.sort((a, b) => a.ts - b.ts)

    // A "duplicate cluster" = entries whose timestamps fall inside the
    // tolerance window from the first one. We greedily form clusters of size
    // ≥2 and report the first such cluster per bucket. (More than one cluster
    // for the same merchant + amount is unusual — would mean repeated weekly
    // double-billing, which is recurring noise.)
    const first = entries[0]
    const cluster = [first]
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].ts - first.ts <= DAY_TOLERANCE_MS) {
        cluster.push(entries[i])
      }
    }
    if (cluster.length < 2) continue

    // Amount tolerance check inside the cluster.
    const amounts = cluster.map((c) => c.amount)
    const minAmt = Math.min(...amounts)
    const maxAmt = Math.max(...amounts)
    if ((maxAmt - minAmt) * 100 > AMOUNT_TOLERANCE_CENTS) continue

    groups.push({
      merchant: titleCase(normaliseMerchant(first.description)),
      amount: Math.round(minAmt * 100) / 100,
      date: first.date,
      txIds: cluster.map((c) => c.id),
      count: cluster.length,
    })
  }

  if (groups.length === 0) return []

  // Pick the most expensive duplicate (most actionable). Ties broken by count.
  groups.sort((a, b) => b.amount * b.count - a.amount * a.count)
  const top = groups[0]

  const symbol = currencySymbol(currency)
  const totalAmount = Math.round(top.amount * top.count * 100) / 100
  const formattedDate = formatShortDate(top.date)

  const claims: VerifiableClaim[] = [
    {
      kind: 'merchant',
      value: top.merchant,
      alt_forms: [top.merchant.toLowerCase(), top.merchant.toUpperCase()],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'amount',
      value: top.amount,
      alt_forms: amountForms(top.amount, symbol),
      source_tx_ids: top.txIds,
    },
    {
      kind: 'amount',
      value: totalAmount,
      alt_forms: amountForms(totalAmount, symbol),
      source_tx_ids: top.txIds,
    },
    {
      kind: 'count',
      value: top.count,
      alt_forms: [String(top.count), countWord(top.count)],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'date',
      value: formattedDate,
      alt_forms: [top.date, formattedDate.toLowerCase()],
      source_tx_ids: top.txIds,
    },
  ]

  return [
    {
      source: 'duplicate_charge',
      evidence_id: `duplicate_charge:${top.merchant.toLowerCase()}:${top.amount}:${top.date}`,
      headline: `${top.merchant} charged ${symbol}${top.amount} ${countWord(top.count)} on ${formattedDate} — likely duplicate billing.`,
      wow_score: 0.95,
      verifiable_claims: claims,
      context_facts: {
        total_double_charge: `${symbol}${totalAmount}`,
      },
      brief: `${top.merchant} charged the user ${symbol}${top.amount} ${countWord(top.count)} on ${formattedDate} — same amount, same day, same merchant. That's almost always a billing error worth disputing. The wow here is *finding free money you didn't know was missing*, not catching them out.`,
      legacy_observation_type: 'high_freq_merchant',
    },
  ]
}

