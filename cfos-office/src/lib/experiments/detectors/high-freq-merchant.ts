import type { Detector, ObservationCandidate } from '../types'
import { currencySymbol, toTitleCase } from '../observation-templates'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

const SKIP_CATEGORIES = new Set(['income', 'transfer'])
const MIN_VISITS = 8 // ~once a week over 90 days

// Detects a single merchant the user visits very frequently. Triggers the
// "rhythm" template — observe the cue (boredom/hunger/habit/treat) before
// each visit for a week. Pure noticing experiment, no behaviour change.
export const highFreqMerchantDetector: Detector = async ({ transactions, currency }) => {
  type Group = { count: number; total: number }
  const groups = new Map<string, Group>()

  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (tx.category && SKIP_CATEGORIES.has(tx.category)) continue
    if (!tx.description) continue
    const key = normaliseMerchant(tx.description)
    if (!key) continue
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.total += Math.abs(tx.amount)
    } else {
      groups.set(key, { count: 1, total: Math.abs(tx.amount) })
    }
  }

  const candidates: ObservationCandidate[] = []
  for (const [key, group] of groups) {
    if (group.count < MIN_VISITS) continue
    candidates.push({
      observation_type: 'high_freq_merchant',
      pattern_template_key: 'rhythm',
      candidate_score: Math.min(0.5 + group.count / 90, 1),
      payload: {
        merchant_name: toTitleCase(key),
        count: group.count,
        total_spend: Math.round(group.total),
        currency_symbol: currencySymbol(currency),
      },
      currency,
    })
  }

  candidates.sort((a, b) => b.candidate_score - a.candidate_score)
  return candidates.slice(0, 1)
}
