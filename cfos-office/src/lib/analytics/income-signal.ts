/**
 * Infer income confidence from transaction history.
 *
 * The point of this function is NOT to compute exact salary — it's a
 * confidence score that the user has regular income of some recognisable
 * cadence. The estimated amount is internal and never quoted to the user.
 *
 * Confidence scoring:
 *   - HIGH (≥0.7): monthly cadence (interval ≈ 28-33 days) with stable
 *     amount (coefficient of variation below ~0.25)
 *   - MEDIUM (0.5-0.7): monthly with high variance, or stable bi-monthly
 *   - LOW (<0.5): irregular cadence or too few candidates
 */

const MIN_AMOUNT = 500
const MIN_COUNT = 3

export interface IncomeSignalInput {
  amount: number
  date: string
}

export interface IncomeSignal {
  confidence: number
  monthly_estimate: number | null
  cadence: 'monthly' | 'bi_monthly' | 'irregular' | 'unknown'
  detected_count: number
}

/**
 * Should the `income_signal` data dependency be marked available at first
 * insight? True when EITHER the inferred cadence is confident OR the user
 * has stated their income directly. The exact amount is never quoted to
 * the LLM (BLOCKED_AT_FIRST_INSIGHT still blocks 'income') — this only
 * flips the availability bit for pattern detectors and experiment templates.
 *
 * Kept here (rather than inline at the call site) so the behaviour can be
 * tested without standing up the full computeFirstInsight pipeline.
 */
export function shouldExposeIncomeSignal(
  signal: IncomeSignal,
  profile: { net_monthly_income?: number | null } | null | undefined,
  threshold: number,
): boolean {
  if (signal.confidence >= threshold) return true
  if (profile?.net_monthly_income != null) return true
  return false
}

export function computeIncomeSignal(transactions: IncomeSignalInput[]): IncomeSignal {
  const candidates = transactions
    .filter((t) => Number(t.amount) >= MIN_AMOUNT)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  if (candidates.length < MIN_COUNT) {
    return {
      confidence: 0,
      monthly_estimate: null,
      cadence: 'unknown',
      detected_count: candidates.length,
    }
  }

  const intervals: number[] = []
  for (let i = 1; i < candidates.length; i++) {
    const prev = new Date(candidates[i - 1].date).getTime()
    const curr = new Date(candidates[i].date).getTime()
    intervals.push((curr - prev) / (1000 * 60 * 60 * 24))
  }

  const sortedIntervals = [...intervals].sort((a, b) => a - b)
  const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)]

  const amounts = candidates.map((t) => Number(t.amount))
  const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
  const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length
  const cv = mean === 0 ? 1 : Math.sqrt(variance) / mean

  let cadence: IncomeSignal['cadence'] = 'irregular'
  let confidence = 0.3
  let monthlyEstimate: number | null = null

  if (medianInterval >= 27 && medianInterval <= 33) {
    cadence = 'monthly'
    monthlyEstimate = mean
    confidence = cv < 0.05 ? 0.9 : cv < 0.15 ? 0.78 : cv < 0.25 ? 0.65 : 0.5
  } else if (medianInterval >= 13 && medianInterval <= 16) {
    cadence = 'bi_monthly'
    monthlyEstimate = mean * 2
    confidence = cv < 0.15 ? 0.7 : 0.5
  }

  return {
    confidence,
    monthly_estimate: monthlyEstimate,
    cadence,
    detected_count: candidates.length,
  }
}
