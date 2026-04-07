import { normaliseMerchant } from './normalise-merchant'

// ── Types ──────────────────────────────────────────────────────────────

export type ContextualSignals = {
  // Exact timing from transaction timestamp
  hour: number // 0-23
  minute: number // 0-59
  day_of_week: number // 0=Sun, 6=Sat
  is_weekend: boolean
  is_friday_evening: boolean // Friday AND hour >= 17
  is_late_night: boolean // hour >= 22 OR hour < 5

  // Pattern signals
  is_recurring: boolean
  same_merchant_frequency: number // total across history + batch
  same_merchant_this_week: number // in same ISO week
  amount_vs_typical: 'normal' | 'high' | 'low'
}

export type MerchantHistory = {
  count: number
  median_amount: number
}

// ── Category ambiguity ─────────────────────────────────────────────────

export const CATEGORY_AMBIGUITY: Record<string, 'low' | 'medium' | 'high'> = {
  housing: 'low',
  utilities_bills: 'low',
  insurance: 'low',
  education: 'low',
  groceries: 'medium',
  transport: 'medium',
  health: 'medium',
  personal_care: 'medium',
  gifts_donations: 'medium',
  subscriptions: 'medium',
  eat_drinking_out: 'high',
  entertainment: 'high',
  shopping: 'high',
  cash: 'high',
}

// ── Signal extraction ──────────────────────────────────────────────────

export function extractSignals(
  txn: {
    date: string
    description: string
    amount: number
    is_recurring?: boolean
  },
  merchantHistory: Map<string, MerchantHistory>,
  batchTransactions?: { date: string; description: string }[]
): ContextualSignals {
  const d = new Date(txn.date)
  const hour = d.getHours()
  const minute = d.getMinutes()
  const day_of_week = d.getDay()
  const is_weekend = day_of_week === 0 || day_of_week === 6
  const is_friday_evening = day_of_week === 5 && hour >= 17
  const is_late_night = hour >= 22 || hour < 5

  const merchant = normaliseMerchant(txn.description)
  const history = merchantHistory.get(merchant)

  // Merchant frequency: historical count + batch count
  const batchCount = batchTransactions
    ? batchTransactions.filter(
        (b) => normaliseMerchant(b.description) === merchant
      ).length
    : 0
  const same_merchant_frequency = (history?.count ?? 0) + batchCount

  // Same merchant this week (ISO week) within the batch
  const txnWeek = isoWeek(d)
  const same_merchant_this_week = batchTransactions
    ? batchTransactions.filter((b) => {
        if (normaliseMerchant(b.description) !== merchant) return false
        return isoWeek(new Date(b.date)) === txnWeek
      }).length
    : 0

  // Amount vs typical: compare to median from history
  let amount_vs_typical: 'normal' | 'high' | 'low' = 'normal'
  if (history && history.median_amount > 0) {
    const absAmount = Math.abs(txn.amount)
    const ratio = absAmount / history.median_amount
    if (ratio > 1.5) amount_vs_typical = 'high'
    else if (ratio < 0.5) amount_vs_typical = 'low'
  }

  return {
    hour,
    minute,
    day_of_week,
    is_weekend,
    is_friday_evening,
    is_late_night,
    is_recurring: txn.is_recurring ?? false,
    same_merchant_frequency,
    same_merchant_this_week,
    amount_vs_typical,
  }
}

// ── Time-of-day confidence multiplier ──────────────────────────────────
// Graduated curve: no discount 07:00–19:00, increasing discount 19:00–23:00,
// maximum discount (~0.5) from 23:00–04:00, recovery 04:00–07:00.
// Friday evenings (17:00+) get an additional ~0.85 modifier.

export function timeOfDayMultiplier(signals: ContextualSignals): number {
  const t = signals.hour + signals.minute / 60 // fractional hour

  let multiplier = 1.0

  if (t >= 7 && t < 19) {
    // Core hours — no discount
    multiplier = 1.0
  } else if (t >= 19 && t < 23) {
    // 19:00–23:00 — linear decline from 1.0 to 0.5
    multiplier = 1.0 - 0.5 * ((t - 19) / 4)
  } else if (t >= 23) {
    // 23:00–23:59 — near maximum discount
    multiplier = 0.5
  } else if (t < 5) {
    // 00:00–04:59 — maximum discount
    multiplier = 0.5
  } else {
    // 05:00–06:59 — recovery from 0.5 to 1.0
    multiplier = 0.5 + 0.5 * ((t - 5) / 2)
  }

  // Friday evening additional modifier
  if (signals.is_friday_evening) {
    multiplier *= 0.85
  }

  return multiplier
}

// ── Helpers ────────────────────────────────────────────────────────────

function isoWeek(d: Date): string {
  // Return "YYYY-Www" for ISO week comparison
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const dayOfYear =
    Math.floor(
      (d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000
    ) + 1
  const weekNum = Math.ceil((dayOfYear + jan4.getDay() - 1) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
