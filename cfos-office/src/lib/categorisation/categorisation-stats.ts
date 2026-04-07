import type { CatResult } from './rules-engine'

export type CategorizationStats = {
  total: number
  categorised: number
  uncategorised: number
  breakdown: {
    user_rule: number
    recurring: number
    db_example: number
    keyword: number
    llm: number
    unmatched: number
  }
  summary: string
}

type TxnWithTier = {
  categoryId: string | null
  confidence: number
  tier: CatResult['tier']
  needsLLM: boolean
}

export function computeCategorizationStats(
  results: TxnWithTier[]
): CategorizationStats {
  const breakdown = {
    user_rule: 0,
    recurring: 0,
    db_example: 0,
    keyword: 0,
    llm: 0,
    unmatched: 0,
  }

  for (const r of results) {
    if (r.needsLLM && r.categoryId) {
      // Was unmatched by rules, then categorised by LLM
      breakdown.llm++
    } else if (r.needsLLM && !r.categoryId) {
      breakdown.unmatched++
    } else {
      // Categorised by rules engine
      switch (r.tier) {
        case 'user_rule':
          breakdown.user_rule++
          break
        case 'recurring':
          breakdown.recurring++
          break
        case 'db_example':
          breakdown.db_example++
          break
        case 'keyword':
          breakdown.keyword++
          break
        default:
          breakdown.unmatched++
      }
    }
  }

  const total = results.length
  const categorised = total - breakdown.unmatched
  const uncategorised = breakdown.unmatched
  const rulesMatched = breakdown.user_rule + breakdown.recurring + breakdown.db_example + breakdown.keyword

  let summary: string
  if (uncategorised === 0) {
    summary = `I categorised all ${total} transactions automatically.`
  } else {
    summary = `I categorised ${categorised} of ${total} transactions automatically. ${uncategorised} need your help.`
  }

  return { total, categorised, uncategorised, breakdown, summary }
}
