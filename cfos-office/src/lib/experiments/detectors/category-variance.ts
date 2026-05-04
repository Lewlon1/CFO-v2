import type { Detector } from '../types'
import { currencySymbol } from '../observation-templates'

const MIN_TOTAL_SPEND = 500
const OBLIGATION_THRESHOLD = 0.75
const CHOSEN_CEILING = 0.10

// Detects users whose spend is dominated by Foundation + Burden (essentials
// and obligations) with very little Investment + Leak (chosen). Names the
// "discipline eats joy" pattern and prompts a one-week noticing log of
// stopped-self purchases.
export const categoryVarianceDetector: Detector = async ({ transactions, currency }) => {
  const totals = new Map<string, number>()
  let totalSpend = 0

  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (tx.category === 'income' || tx.category === 'transfer') continue
    const cat = tx.value_category ?? 'unclassified'
    const amt = Math.abs(tx.amount)
    totals.set(cat, (totals.get(cat) ?? 0) + amt)
    totalSpend += amt
  }
  if (totalSpend < MIN_TOTAL_SPEND) return []

  const foundation = totals.get('foundation') ?? 0
  const burden = totals.get('burden') ?? 0
  const investment = totals.get('investment') ?? 0
  const leak = totals.get('leak') ?? 0
  const obligationShare = (foundation + burden) / totalSpend
  const chosenShare = (investment + leak) / totalSpend
  if (obligationShare < OBLIGATION_THRESHOLD) return []
  if (chosenShare > CHOSEN_CEILING) return []

  const score = Math.min((obligationShare - OBLIGATION_THRESHOLD) * 4, 1)
  return [
    {
      observation_type: 'category_variance',
      pattern_template_key: 'discipline_eats_joy',
      candidate_score: score,
      payload: {
        locked_share: Math.round(obligationShare * 100),
        currency_symbol: currencySymbol(currency),
        locked_category_label: 'necessities and obligations',
        foundation_total: Math.round(foundation),
        burden_total: Math.round(burden),
        investment_total: Math.round(investment),
        leak_total: Math.round(leak),
        total_spend: Math.round(totalSpend),
      },
      currency,
    },
  ]
}
