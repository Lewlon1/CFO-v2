import { baseConfidence } from './confidence'
import type { CorrectionSignal, RuleCandidate, ValueCategoryType } from './types'

type WeightedCounts = Map<ValueCategoryType, number>

function weightedCounts(signals: CorrectionSignal[]): WeightedCounts {
  const counts = new Map<ValueCategoryType, number>()
  for (const s of signals) {
    counts.set(s.value_category, (counts.get(s.value_category) ?? 0) + s.weight_multiplier)
  }
  return counts
}

function dominant(counts: WeightedCounts): { category: ValueCategoryType; count: number; total: number; ratio: number } | null {
  let best: ValueCategoryType | null = null
  let bestCount = 0
  let total = 0
  for (const [cat, count] of counts) {
    total += count
    if (count > bestCount) {
      bestCount = count
      best = cat
    }
  }
  if (!best || total === 0) return null
  return { category: best, count: bestCount, total, ratio: Math.round((bestCount / total) * 100) / 100 }
}

/**
 * Compute a flat merchant rule from signals.
 * Returns null if agreement_ratio < 0.55 (context-dependent merchant).
 */
export function computeFlatRule(merchantClean: string, signals: CorrectionSignal[]): RuleCandidate | null {
  if (signals.length === 0) return null
  const counts = weightedCounts(signals)
  const d = dominant(counts)
  if (!d) return null
  if (d.ratio < 0.55) return null

  return {
    match_type: 'merchant',
    match_value: merchantClean,
    value_category: d.category,
    confidence: baseConfidence(signals.length, d.ratio),
    total_signals: signals.length,
    agreement_ratio: d.ratio,
    avg_amount_low: null,
    avg_amount_high: null,
    time_context: null,
    source: 'learned',
  }
}

/**
 * Check for time-sensitive patterns.
 * Creates merchant_time rules for time_context groups with >= 2 signals
 * and agreement >= 0.70 where the dominant differs from the flat rule
 * (or flat rule doesn't exist).
 */
export function computeTimeRules(
  merchantClean: string,
  signals: CorrectionSignal[],
  flatRule: RuleCandidate | null
): RuleCandidate[] {
  const groups = new Map<string, CorrectionSignal[]>()
  for (const s of signals) {
    const arr = groups.get(s.time_context) ?? []
    arr.push(s)
    groups.set(s.time_context, arr)
  }

  const rules: RuleCandidate[] = []
  for (const [timeContext, group] of groups) {
    if (group.length < 2) continue
    const counts = weightedCounts(group)
    const d = dominant(counts)
    if (!d || d.ratio < 0.70) continue
    if (flatRule && d.category === flatRule.value_category) continue

    rules.push({
      match_type: 'merchant_time',
      match_value: merchantClean,
      value_category: d.category,
      confidence: Math.round(baseConfidence(group.length, d.ratio) * 0.95 * 100) / 100,
      total_signals: group.length,
      agreement_ratio: d.ratio,
      avg_amount_low: null,
      avg_amount_high: null,
      time_context: timeContext,
      source: 'learned',
    })
  }
  return rules
}

/**
 * Check for amount-sensitive patterns.
 * Splits signals at median amount into 2 bands.
 * If both bands have >= 2 signals, different dominants, and agreement >= 0.65,
 * creates merchant_amount rules and signals to delete the flat rule.
 */
export function computeAmountRules(
  merchantClean: string,
  signals: CorrectionSignal[]
): { rules: RuleCandidate[]; deleteFlatRule: boolean } {
  if (signals.length < 4) return { rules: [], deleteFlatRule: false }

  const sorted = [...signals].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount))
  const mid = Math.floor(sorted.length / 2)
  const lowBand = sorted.slice(0, mid)
  const highBand = sorted.slice(mid)

  if (lowBand.length < 2 || highBand.length < 2) return { rules: [], deleteFlatRule: false }

  const lowD = dominant(weightedCounts(lowBand))
  const highD = dominant(weightedCounts(highBand))
  if (!lowD || !highD) return { rules: [], deleteFlatRule: false }
  if (lowD.category === highD.category) return { rules: [], deleteFlatRule: false }
  if (lowD.ratio < 0.65 || highD.ratio < 0.65) return { rules: [], deleteFlatRule: false }

  const boundary = Math.abs(sorted[mid - 1].amount)
  const boundaryHigh = Math.abs(sorted[mid].amount)

  return {
    deleteFlatRule: true,
    rules: [
      {
        match_type: 'merchant_amount',
        match_value: merchantClean,
        value_category: lowD.category,
        confidence: baseConfidence(lowBand.length, lowD.ratio),
        total_signals: lowBand.length,
        agreement_ratio: lowD.ratio,
        avg_amount_low: null,
        avg_amount_high: Math.round(((boundary + boundaryHigh) / 2) * 100) / 100,
        time_context: null,
        source: 'learned',
      },
      {
        match_type: 'merchant_amount',
        match_value: merchantClean,
        value_category: highD.category,
        confidence: baseConfidence(highBand.length, highD.ratio),
        total_signals: highBand.length,
        agreement_ratio: highD.ratio,
        avg_amount_low: Math.round(((boundary + boundaryHigh) / 2) * 100) / 100,
        avg_amount_high: null,
        time_context: null,
        source: 'learned',
      },
    ],
  }
}

/**
 * Compute a category-level or global prior from a set of signals.
 * Used for fallback rules when no merchant-specific rule matches.
 */
export function computePriorRule(
  matchType: 'category' | 'global',
  matchValue: string,
  signals: CorrectionSignal[]
): RuleCandidate | null {
  if (signals.length === 0) return null
  const counts = weightedCounts(signals)
  const d = dominant(counts)
  if (!d) return null

  return {
    match_type: matchType,
    match_value: matchValue,
    value_category: d.category,
    confidence: baseConfidence(signals.length, d.ratio),
    total_signals: signals.length,
    agreement_ratio: d.ratio,
    avg_amount_low: null,
    avg_amount_high: null,
    time_context: null,
    source: 'learned',
  }
}
