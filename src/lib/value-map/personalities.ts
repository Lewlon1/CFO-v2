import type { ValueMapResult, MoneyPersonality, ValueQuadrant } from './types'
import { PERSONALITIES } from './constants'

interface PersonalityResult {
  personality: MoneyPersonality
  name: string
  emoji: string
  headline: string
  description: string
  breakdown: Record<ValueQuadrant, { total: number; percentage: number; count: number }>
}

/**
 * Calculates the Money Personality from Value Map results.
 *
 * Priority order: Drifter > Anchor > Builder > Fortress > Truth Teller
 * (check concerning patterns first, then positive, then balanced)
 */
export function calculatePersonality(results: ValueMapResult[]): PersonalityResult {
  // Filter out hard-to-decide results (null quadrant) for personality calculation
  const decided = results.filter((r): r is ValueMapResult & { quadrant: ValueQuadrant } => r.quadrant !== null)
  const totalSpend = decided.reduce((sum, r) => sum + r.amount, 0)

  const breakdown: Record<ValueQuadrant, { total: number; percentage: number; count: number }> = {
    foundation: { total: 0, percentage: 0, count: 0 },
    investment: { total: 0, percentage: 0, count: 0 },
    burden: { total: 0, percentage: 0, count: 0 },
    leak: { total: 0, percentage: 0, count: 0 },
  }

  for (const r of decided) {
    breakdown[r.quadrant].total += r.amount
    breakdown[r.quadrant].count++
  }

  // Calculate percentages
  for (const q of Object.keys(breakdown) as ValueQuadrant[]) {
    breakdown[q].percentage = totalSpend > 0
      ? Math.round((breakdown[q].total / totalSpend) * 100)
      : 0
  }

  // Determine personality (priority: concerning first)
  let personality: MoneyPersonality = 'truth_teller'

  if (breakdown.leak.percentage >= 25) {
    personality = 'drifter'
  } else if (breakdown.burden.percentage >= 30) {
    personality = 'anchor'
  } else if (breakdown.investment.percentage >= 35) {
    personality = 'builder'
  } else if (breakdown.foundation.percentage >= 50) {
    personality = 'fortress'
  }

  const def = PERSONALITIES[personality]

  return {
    personality,
    name: def.name,
    emoji: def.emoji,
    headline: def.headline,
    description: def.description,
    breakdown,
  }
}
