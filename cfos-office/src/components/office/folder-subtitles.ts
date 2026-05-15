import type { PrimaryGoal } from '@/lib/goals/primary-goal'
import type { DashboardSummary } from '@/app/api/dashboard/summary/route'

// Goal-aware folder card subtitles for the four non-Goals folders.
//
// Voice rules (Constitution v1.3 §2):
//   - Short declaratives, second person where applicable
//   - No first person, no "advice/advise", no exclamation marks
//   - Real numbers only — never fabricate
//
// Goal connection (Constitution v1.3 §3):
//   - Mention the goal only when the connection is real (e.g. surplus that
//     genuinely funds it). Deficits and negative net worth state the fact
//     plainly without goal commentary.
//   - When the user has no goal, fall back to neutral copy. The no-goal
//     prompt is already carried by the Goals card and the CFO chat layer;
//     the other folders do not pile on.

/**
 * Cash Flow subtitle.
 *
 * Surplus + goal → "€460 surplus this month · feeds your goal"
 * Surplus, no goal → "€460 surplus this month"
 * Deficit (any goal state) → "€120 short this month"
 * Zero (any goal state) → "Even this month"
 * No summary data → caller-provided fallback (preserves existing month/count shape)
 */
export function cashFlowSubtitle(
  summary: Pick<DashboardSummary, 'surplus_deficit'> | null | undefined,
  primaryGoal: PrimaryGoal | null,
  fallback: string,
): string {
  if (!summary) return fallback

  const value = summary.surplus_deficit
  const formatted = formatEuros(Math.abs(value))

  if (value > 0) {
    return primaryGoal
      ? `${formatted} surplus this month · feeds your goal`
      : `${formatted} surplus this month`
  }
  if (value < 0) {
    return `${formatted} short this month`
  }
  return 'Even this month'
}

/**
 * Net Worth subtitle.
 *
 * Has totals + goal → "€42,180 net worth · the goal lives here"
 * Has totals, no goal → "€42,180 net worth"
 * All zero → "Add what you own and owe"
 *
 * Negative net worth still appends the goal line — the goal is a destination
 * inside the picture, even when the picture is currently negative. Stating
 * the figure plainly is in voice; suppressing the goal line on a negative
 * total would be editorialising in the opposite direction.
 */
export function netWorthSubtitle(
  totalAssets: number,
  totalLiabilities: number,
  primaryGoal: PrimaryGoal | null,
): string {
  if (totalAssets === 0 && totalLiabilities === 0) {
    return 'Add what you own and owe'
  }
  const net = totalAssets - totalLiabilities
  const formatted = formatEuros(Math.abs(net))
  const sign = net < 0 ? '-' : ''
  const base = `${sign}${formatted} net worth`
  return primaryGoal ? `${base} · the goal lives here` : base
}

/**
 * Values subtitle.
 *
 * Archetype + goal → "Architect · the patterns under your goal"
 * Archetype, no goal → "Architect · 87% profiled" (existing copy)
 * No archetype + goal → "Build your portrait — the patterns under your goal"
 * No archetype, no goal → "Build your portrait"
 */
export function valuesSubtitle(
  archetypeName: string | null,
  profileCompleteness: number,
  primaryGoal: PrimaryGoal | null,
): string {
  if (!archetypeName) {
    return primaryGoal
      ? 'Build your portrait — the patterns under your goal'
      : 'Build your portrait'
  }
  if (primaryGoal) {
    return `${archetypeName} · the patterns under your goal`
  }
  return `${archetypeName} · ${Math.round(profileCompleteness)}% profiled`
}

/**
 * Scenarios subtitle.
 *
 * Goal → "What shifts your goal's pace"
 * No goal → "What if..." (existing)
 *
 * Per Constitution §3: "the CFO names a spending pattern against the goal's
 * pace." Scenarios is where pace is modelled; the subtitle says so when a
 * goal exists.
 */
export function scenariosSubtitle(primaryGoal: PrimaryGoal | null): string {
  return primaryGoal ? "What shifts your goal's pace" : 'What if...'
}

function formatEuros(absValue: number): string {
  return `€${Math.round(absValue).toLocaleString('en-IE')}`
}
