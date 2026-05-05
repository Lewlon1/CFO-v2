// Big-ticket surprise detector. Finds a single transaction whose absolute
// amount stands out dramatically from the user's baseline. The wow comes
// from the contrast: someone who normally spends €5–30 per transaction sees
// a €485 charge, and even though they paid it deliberately, the size hits
// differently when surfaced.
//
// Recurring exclusion is conditional, not blanket. We exclude
// merchants the caller flags as recurring (rent, salary, utilities) ONLY
// when the amount is below the headline thresholds. For amounts that clear
// 8× the user's median expense AND 4× any other merchant's max, the
// recurring flag is ignored — those are anomalies regardless of how the
// description repeats. This catches the €5,450 ATM block whose "recurring"
// flag is a false positive from over-eager periodicity detection on
// identical descriptions.

import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import type { Evidence, TransactionRow, VerifiableClaim } from '@/lib/experiments/types'
import { currencySymbol } from '@/lib/experiments/observation-templates'
import { amountForms, formatShortDate, titleCase } from './evidence-helpers'

const MEDIAN_MULTIPLIER = 8        // big-ticket = 8× median expense
const MERCHANT_MAX_MULTIPLIER = 4  // and 4× this user's typical merchant max
const MIN_ABSOLUTE = 100           // floor: don't fire on a €40 surprise

export interface BigTicketInput {
  transactions: TransactionRow[]
  recurringMerchants?: Set<string>
  currency: string
}

export function detectBigTicketSurprise({
  transactions,
  recurringMerchants,
  currency,
}: BigTicketInput): Evidence[] {
  // Build the expense baseline:
  //   - all expenses (amount < 0), excluding income/transfer rows
  //   - excluding recurring merchants (rent, utilities, subscriptions) FROM
  //     the baseline so a single huge non-recurring charge isn't compared
  //     against rent. Recurring rows can still be candidates below if they
  //     clear the override thresholds.
  // Then compute median expense + per-merchant max.
  const expenseAmounts: number[] = []
  const merchantMax = new Map<string, number>()

  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (tx.category === 'income' || tx.category === 'transfer') continue
    const abs = Math.abs(tx.amount)
    if (!tx.description) continue
    const merchant = normaliseMerchant(tx.description)
    if (!merchant) continue
    if (recurringMerchants?.has(merchant)) continue
    expenseAmounts.push(abs)
    merchantMax.set(merchant, Math.max(merchantMax.get(merchant) ?? 0, abs))
  }
  if (expenseAmounts.length < 20) return [] // not enough baseline

  expenseAmounts.sort((a, b) => a - b)
  const median = expenseAmounts[Math.floor(expenseAmounts.length / 2)]
  if (median <= 0) return []

  // Find the candidate big-ticket: the largest expense that is at least
  // MEDIAN_MULTIPLIER× median AND ≥ MIN_ABSOLUTE AND ≥ MERCHANT_MAX_MULTIPLIER×
  // the user's typical max for OTHER merchants.
  //
  // Recurring rule: skip recurring merchants UNLESS the amount clears BOTH
  // anomaly gates, in which case the recurring flag is overridden.

  let best: { tx: TransactionRow; abs: number; merchant: string } | null = null
  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (tx.category === 'income' || tx.category === 'transfer') continue
    const abs = Math.abs(tx.amount)
    if (abs < MIN_ABSOLUTE) continue
    if (abs < median * MEDIAN_MULTIPLIER) continue
    if (!tx.description) continue
    const merchant = normaliseMerchant(tx.description)
    if (!merchant) continue

    // Compare to the max EXCLUDING this merchant (so a single outlier doesn't
    // become its own baseline).
    let otherMax = 0
    for (const [m, mx] of merchantMax) {
      if (m === merchant) continue
      if (mx > otherMax) otherMax = mx
    }
    if (otherMax > 0 && abs < otherMax * MERCHANT_MAX_MULTIPLIER) continue

    // Recurring override: skip recurring merchants unless the amount is
    // also clear of BOTH anomaly thresholds. Above that bar the row is an
    // anomaly regardless of description repetition (catches the €5,450
    // Compra Revolut block whose recurring flag is over-eager).
    if (recurringMerchants?.has(merchant)) {
      const clearsMedian = abs >= median * MEDIAN_MULTIPLIER
      const clearsMerchant = otherMax === 0 || abs >= otherMax * MERCHANT_MAX_MULTIPLIER
      if (!(clearsMedian && clearsMerchant)) continue
    }

    if (!best || abs > best.abs) {
      best = { tx, abs, merchant }
    }
  }

  if (!best) return []

  const { tx, abs, merchant } = best
  const display = titleCase(merchant)
  const symbol = currencySymbol(currency)
  const dateIso = tx.date.slice(0, 10)
  const formattedDate = formatShortDate(dateIso)
  const multiplier = Math.round(abs / median)

  // Score: more outlier = higher score. Lifted minimum from 0.55 → 0.65
  // (Wave 2 / E1) so a real big-ticket evidence clears the new 0.6 Tier-1
  // threshold without relying on the upper end.
  const score = Math.min(0.65 + Math.log10(multiplier) * 0.13, 0.85)

  const claims: VerifiableClaim[] = [
    {
      kind: 'merchant',
      value: display,
      alt_forms: [display.toLowerCase(), display.toUpperCase()],
      source_tx_ids: [tx.id],
    },
    {
      kind: 'amount',
      value: Math.round(abs * 100) / 100,
      alt_forms: amountForms(abs, symbol),
      source_tx_ids: [tx.id],
    },
    {
      kind: 'date',
      value: formattedDate,
      alt_forms: [dateIso, formattedDate.toLowerCase()],
      source_tx_ids: [tx.id],
    },
    {
      kind: 'amount',
      value: Math.round(median),
      alt_forms: amountForms(median, symbol),
    },
  ]

  return [
    {
      source: 'big_ticket',
      evidence_id: `big_ticket:${merchant}:${dateIso}`,
      headline: `${display} ${symbol}${abs.toFixed(2)} on ${formattedDate} — about ${multiplier}× the user's typical expense.`,
      wow_score: score,
      verifiable_claims: claims,
      context_facts: {
        median_expense: `${symbol}${Math.round(median)}`,
      },
      brief: `On ${formattedDate} a single charge of ${symbol}${abs.toFixed(2)} at ${display} — roughly ${multiplier}× the user's typical expense (median ${symbol}${Math.round(median)}). Big charges have a way of vanishing into the average; pulled out of context, the size of this one tends to stop people. Not "should you have spent it" — more "did this match how it felt at the time?"`,
      legacy_observation_type: 'high_freq_merchant',
    },
  ]
}
