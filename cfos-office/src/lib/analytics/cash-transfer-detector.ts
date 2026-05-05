// Cash-transfer detector. Surfaces opaque outflows: clusters of transactions
// that move money OUT of the user's account in a way the rest of the
// pipeline can't follow — Revolut transfers, Wise loads, ATM withdrawals,
// generic "transfer" entries. The wow comes from the cumulative size and
// the implicit question "where did that go?"
//
// Distinct from `foreign-fee-aggregator`:
//   - foreign-fee targets visible *fees* (FX, ATM service charges)
//   - this targets *capital movement* — money that leaves the visible
//     spend graph without a category to land in
//
// Distinct from big-ticket-surprise:
//   - big-ticket is one large charge
//   - this is a *cluster* whose individual amounts may not be remarkable
//     but whose total is

import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import type { Evidence, TransactionRow, VerifiableClaim } from '@/lib/experiments/types'
import { currencySymbol } from '@/lib/experiments/observation-templates'
import { amountForms, formatShortDate, titleCase } from './evidence-helpers'

const MIN_TX_COUNT = 3
const MIN_TOTAL = 1500
const MIN_TOTAL_PCT_OF_SPEND = 0.30 // 30% of total visible spend

// Description patterns that signal "this is a transfer, not a purchase."
// Conservative — false positives here surface a wow that isn't actually
// opaque, undermining trust.
const TRANSFER_PATTERNS: RegExp[] = [
  /\bcompra revolut/i,
  /\brevolut\*\*/i,
  /\bto\s+eur\b/i,
  /\bto\s+gbp\b/i,
  /\bto\s+usd\b/i,
  /\bwise\b/i,
  /\bwire transfer\b/i,
  /\binternational transfer\b/i,
  /\bcash withdrawal\b/i,
  /\batm\b/i,
  /\bcash machine\b/i,
  /\btransfer to\b/i,
  /\bsend money\b/i,
  /retirada (de )?efectivo/i,           // Spanish ATM withdrawal
  /traspaso/i,                           // Spanish: transfer
]

export interface CashTransferInput {
  transactions: TransactionRow[]
  currency: string
}

interface TransferGroup {
  merchant: string                       // display name
  count: number
  total: number
  txIds: string[]
  firstDate: string
  lastDate: string
  spanDays: number
}

export function detectCashTransfers({
  transactions,
  currency,
}: CashTransferInput): Evidence[] {
  // Compute total visible spend so we can apply the 30%-of-spend gate.
  let totalSpend = 0
  for (const tx of transactions) {
    if (tx.amount < 0) totalSpend += Math.abs(tx.amount)
  }

  // Group transactions whose description matches a transfer pattern by
  // normalised merchant. If the user has multiple distinct transfer
  // destinations, each is its own candidate; we surface the largest.
  type Entry = { ts: number; id: string; amount: number; date: string }
  const buckets = new Map<string, Entry[]>()

  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (!tx.description) continue
    if (!TRANSFER_PATTERNS.some((p) => p.test(tx.description))) continue

    const merchant = normaliseMerchant(tx.description) || tx.description.slice(0, 40)
    const ts = Date.parse(tx.date)
    if (Number.isNaN(ts)) continue

    const arr = buckets.get(merchant) ?? []
    arr.push({ ts, id: tx.id, amount: Math.abs(tx.amount), date: tx.date.slice(0, 10) })
    buckets.set(merchant, arr)
  }

  const groups: TransferGroup[] = []
  for (const [merchant, entries] of buckets) {
    if (entries.length < MIN_TX_COUNT) continue
    entries.sort((a, b) => a.ts - b.ts)
    const total = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100
    const meetsAbsolute = total >= MIN_TOTAL
    const meetsRelative = totalSpend > 0 && total / totalSpend >= MIN_TOTAL_PCT_OF_SPEND
    if (!meetsAbsolute && !meetsRelative) continue

    const firstDate = entries[0].date
    const lastDate = entries[entries.length - 1].date
    const spanDays = Math.max(
      1,
      Math.round((entries[entries.length - 1].ts - entries[0].ts) / (24 * 60 * 60 * 1000)),
    )
    groups.push({
      merchant: titleCase(merchant),
      count: entries.length,
      total,
      txIds: entries.map((e) => e.id),
      firstDate,
      lastDate,
      spanDays,
    })
  }

  if (groups.length === 0) return []

  // Pick the largest by total. Ties broken by count (more transactions =
  // stronger "this is a habit, not a one-off" signal).
  groups.sort((a, b) => b.total - a.total || b.count - a.count)
  const top = groups[0]

  const symbol = currencySymbol(currency)
  const wow_score = top.total >= 5000 ? 0.85 : 0.7

  const claims: VerifiableClaim[] = [
    {
      kind: 'merchant',
      value: top.merchant,
      alt_forms: [top.merchant.toLowerCase(), top.merchant.toUpperCase()],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'amount',
      value: top.total,
      alt_forms: amountForms(top.total, symbol),
      source_tx_ids: top.txIds,
    },
    {
      kind: 'count',
      value: top.count,
      alt_forms: [String(top.count)],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'duration',
      value: top.spanDays,
      alt_forms: [String(top.spanDays), `${top.spanDays} days`],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'date',
      value: formatShortDate(top.firstDate),
      alt_forms: [top.firstDate, formatShortDate(top.firstDate).toLowerCase()],
      source_tx_ids: top.txIds,
    },
    {
      kind: 'date',
      value: formatShortDate(top.lastDate),
      alt_forms: [top.lastDate, formatShortDate(top.lastDate).toLowerCase()],
      source_tx_ids: top.txIds,
    },
  ]

  const brief = `${top.count} transfers totalling ${symbol}${top.total} have moved out via ${top.merchant} across ${top.spanDays} days. Once it leaves through this rail, it disappears from any spending picture I can read. Not a judgement — a question worth asking out loud: where did it go, and was that the plan?`

  return [
    {
      source: 'cash_transfer',
      evidence_id: `cash_transfer:${top.merchant.toLowerCase()}:${top.firstDate}`,
      headline: `${top.count} transfers via ${top.merchant} totalling ${symbol}${top.total} — opaque outflow over ${top.spanDays} days.`,
      wow_score,
      verifiable_claims: claims,
      context_facts: {
        first_date: top.firstDate,
        last_date: top.lastDate,
        opaque_outflow: 'yes',
      },
      brief,
      legacy_observation_type: 'high_freq_merchant',
    },
  ]
}
