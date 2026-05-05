// Foreign-fee + ATM-fee aggregator. Sums up the silent costs of using a card
// abroad: non-sterling/non-base-currency conversion fees, FX margins captured
// as visible fees, and ATM withdrawal fees. The "wow" here is cumulative —
// a single €1.50 fee is unremarkable, but €40+ over a quarter is the kind of
// thing the user has never tallied themselves.
//
// We do NOT have access to a separate "fee" column in `transactions` (the
// schema flattens fees into `amount`). Instead we infer fees from
// description patterns established by Revolut, Wise, Monzo, BBVA etc.

import type { Evidence, TransactionRow, VerifiableClaim } from '@/lib/experiments/types'
import { currencySymbol } from '@/lib/experiments/observation-templates'
import { amountForms } from './evidence-helpers'

const MIN_TOTAL_ABSOLUTE = 25     // €25 / £25 / $25 floor
const MIN_TOTAL_PCT_OF_SPEND = 0.005 // 0.5% of total spend (whichever is higher)

// Description patterns that strongly indicate a fee or FX-loaded charge.
// Conservative — false positives here hallucinate a fee where there isn't
// one, which would torpedo trust.
const FEE_PATTERNS: Array<{ regex: RegExp; kind: 'fx_fee' | 'atm_fee' | 'atm_withdrawal' }> = [
  { regex: /non[-\s]*sterling transaction fee/i, kind: 'fx_fee' },
  { regex: /foreign transaction fee/i, kind: 'fx_fee' },
  { regex: /currency conversion fee/i, kind: 'fx_fee' },
  { regex: /\bfx fee\b/i, kind: 'fx_fee' },
  { regex: /atm fee/i, kind: 'atm_fee' },
  { regex: /cash withdrawal fee/i, kind: 'atm_fee' },
  { regex: /comisi[oó]n.*cajero/i, kind: 'atm_fee' },                       // BBVA Spanish ATM fee
  { regex: /\batm withdrawal\b/i, kind: 'atm_withdrawal' },
  { regex: /cash machine/i, kind: 'atm_withdrawal' },
  { regex: /retirada (de )?efectivo/i, kind: 'atm_withdrawal' },           // Spanish ATM withdrawal
]

export interface ForeignFeeInput {
  transactions: TransactionRow[]
  currency: string
}

export function detectForeignFees({ transactions, currency }: ForeignFeeInput): Evidence[] {
  let feeTotal = 0
  let atmTotal = 0
  let withdrawalTotal = 0
  let withdrawalCount = 0
  let totalSpend = 0
  const feeTxIds: string[] = []
  const atmTxIds: string[] = []
  const withdrawalTxIds: string[] = []

  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    const abs = Math.abs(tx.amount)
    totalSpend += abs

    if (!tx.description) continue
    for (const pattern of FEE_PATTERNS) {
      if (!pattern.regex.test(tx.description)) continue
      if (pattern.kind === 'fx_fee') {
        feeTotal += abs
        feeTxIds.push(tx.id)
      } else if (pattern.kind === 'atm_fee') {
        atmTotal += abs
        atmTxIds.push(tx.id)
      } else if (pattern.kind === 'atm_withdrawal') {
        withdrawalTotal += abs
        withdrawalCount += 1
        withdrawalTxIds.push(tx.id)
      }
      break // first matching pattern wins per tx
    }
  }

  const feesAndAtmFees = Math.round((feeTotal + atmTotal) * 100) / 100
  const wTotal = Math.round(withdrawalTotal * 100) / 100
  const symbol = currencySymbol(currency)

  // Two paths:
  //   1. Real fees totalled past the threshold → "you've paid X in fees you
  //      didn't see" wow.
  //   2. No literal fees but a notable cash-withdrawal pattern (e.g. €4,000
  //      over 5 ATM trips) → "you've pulled X in cash, which I can't see
  //      where it went" wow.
  // Both are valid. We pick the stronger one.

  const evidences: Evidence[] = []

  const feeThreshold = Math.max(MIN_TOTAL_ABSOLUTE, totalSpend * MIN_TOTAL_PCT_OF_SPEND)

  if (feesAndAtmFees >= feeThreshold) {
    // Lifted minimum from 0.7 → 0.75 (Wave 2 / E1) to keep quality high
    // when the new lower Tier-1 threshold (0.6) lets more candidates
    // through.
    const score = Math.min(0.75 + Math.log10(1 + feesAndAtmFees / feeThreshold) * 0.18, 0.95)
    const claims: VerifiableClaim[] = [
      {
        kind: 'amount',
        value: feesAndAtmFees,
        alt_forms: amountForms(feesAndAtmFees, symbol),
        source_tx_ids: [...feeTxIds, ...atmTxIds],
      },
    ]
    if (feeTxIds.length > 0) {
      claims.push({
        kind: 'count',
        value: feeTxIds.length,
        alt_forms: [String(feeTxIds.length)],
        source_tx_ids: feeTxIds,
      })
    }

    evidences.push({
      source: 'foreign_fee',
      evidence_id: `foreign_fee:fees:${feesAndAtmFees}`,
      headline: `${symbol}${feesAndAtmFees} in foreign / ATM fees over the window — money the user almost certainly hasn't tallied.`,
      wow_score: score,
      verifiable_claims: claims,
      context_facts: {
        category: 'invisible_fees',
      },
      brief: `${symbol}${feesAndAtmFees} in non-sterling / FX / ATM fees over 90 days — the silent cost of using a card abroad. Almost no one tallies these themselves; they each feel like rounding errors and somehow add up to a real number. Naming the figure is the wow.`,
      legacy_observation_type: 'high_freq_merchant',
    })
  }

  if (withdrawalCount >= 3 && wTotal >= 200) {
    // Cash withdrawal pattern is its own evidence — separate from fees.
    // Score scales with both count and absolute total. Lifted minimum
    // from 0.65 → 0.7 (Wave 2 / E1).
    const score = Math.min(0.7 + Math.log10(1 + wTotal / 500) * 0.15, 0.9)
    const claims: VerifiableClaim[] = [
      {
        kind: 'amount',
        value: wTotal,
        alt_forms: amountForms(wTotal, symbol),
        source_tx_ids: withdrawalTxIds,
      },
      {
        kind: 'count',
        value: withdrawalCount,
        alt_forms: [String(withdrawalCount)],
        source_tx_ids: withdrawalTxIds,
      },
    ]
    evidences.push({
      source: 'foreign_fee',
      evidence_id: `foreign_fee:cash:${wTotal}`,
      headline: `${withdrawalCount} cash withdrawals totalling ${symbol}${wTotal} — large untraceable spend.`,
      wow_score: score,
      verifiable_claims: claims,
      context_facts: {
        category: 'cash_withdrawals',
      },
      brief: `${symbol}${wTotal} pulled in cash across ${withdrawalCount} withdrawals. Once money becomes cash it disappears from any spending picture — by definition, no merchant, no category, no story. Worth surfacing the size of it without judgement; the user can decide whether that's deliberate freedom or unaccounted drift.`,
      legacy_observation_type: 'high_freq_merchant',
    })
  }

  return evidences
}
