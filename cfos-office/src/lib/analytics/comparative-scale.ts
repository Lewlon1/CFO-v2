// Comparative-scale enricher. Given a monetary headline (e.g. €485 single
// charge, €4,000 cash withdrawn), attaches resonant comparators from the
// user's own data: "≈ X days of groceries", "≈ N% of monthly income",
// "≈ M weeks of rent". This is what unlocks prose like "€485 — that's
// about a fortnight of your shopping" from the Opus author.
//
// Pure pricing logic; no LLM. The numbers themselves still go through the
// claim validator, so attaching a context_fact here also adds it to the
// claim pool.

import type { Evidence, VerifiableClaim } from '@/lib/experiments/types'
import { currencySymbol } from '@/lib/experiments/observation-templates'
import { amountForms } from './evidence-helpers'

export interface UserScaleContext {
  // 30-day income average (best estimate from monthly snapshots / detected
  // salary deposits). Null when we can't infer it.
  monthlyIncome: number | null
  // 30-day total spend.
  monthlySpend: number | null
  // Largest known recurring expense (rent / mortgage). Null when unknown.
  rent: number | null
  // Median weekly spend at top "groceries" category. Null when unknown.
  weeklyGroceries: number | null
  currency: string
}

// Returns an Evidence with `context_facts` populated and (importantly) the
// referenced numbers added to `verifiable_claims` so the validator allows
// them in Opus's prose.
export function enrichWithComparators(
  evidence: Evidence,
  ctx: UserScaleContext,
): Evidence {
  // Find the headline amount inside this evidence — the largest amount-typed
  // claim. That's the figure we want to scale.
  const amountClaims = evidence.verifiable_claims.filter((c) => c.kind === 'amount')
  if (amountClaims.length === 0) return evidence
  const headlineAmount = amountClaims
    .map((c) => Number(c.value))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => b - a)[0]
  if (!headlineAmount || headlineAmount <= 0) return evidence

  const symbol = currencySymbol(ctx.currency)
  const newContext: Record<string, string | number> = { ...evidence.context_facts }
  const newClaims: VerifiableClaim[] = [...evidence.verifiable_claims]

  if (ctx.monthlyIncome && ctx.monthlyIncome > 0) {
    const pct = Math.round((headlineAmount / ctx.monthlyIncome) * 100)
    if (pct >= 1) {
      newContext.pct_of_monthly_income = `${pct}%`
      newClaims.push({
        kind: 'percent',
        value: pct,
        alt_forms: [String(pct), `${pct}%`, `${pct} percent`],
      })
    }
  }

  if (ctx.monthlySpend && ctx.monthlySpend > 0) {
    const pct = Math.round((headlineAmount / ctx.monthlySpend) * 100)
    if (pct >= 5) {
      newContext.pct_of_monthly_spend = `${pct}%`
      newClaims.push({
        kind: 'percent',
        value: pct,
        alt_forms: [String(pct), `${pct}%`],
      })
    }
  }

  if (ctx.weeklyGroceries && ctx.weeklyGroceries > 0) {
    const weeks = Math.round(headlineAmount / ctx.weeklyGroceries)
    if (weeks >= 1 && weeks <= 26) {
      newContext.equates_to_weeks_of_groceries = weeks
      newClaims.push({
        kind: 'duration',
        value: weeks,
        alt_forms: [String(weeks), `${weeks} weeks`, `${weeks} weeks of groceries`],
      })
    }
  }

  if (ctx.rent && ctx.rent > 0) {
    const ratio = headlineAmount / ctx.rent
    if (ratio >= 0.25 && ratio <= 12) {
      const months = Math.round(ratio * 10) / 10
      newContext.fraction_of_rent =
        ratio >= 1 ? `${Math.round(ratio)}× rent` : `${Math.round(ratio * 100)}% of rent`
      const intMonths = Math.max(1, Math.round(ratio))
      newClaims.push({
        kind: 'duration',
        value: intMonths,
        alt_forms: [String(intMonths), `${intMonths} months`, `${months} months of rent`],
      })
      newClaims.push({
        kind: 'amount',
        value: Math.round(ctx.rent),
        alt_forms: amountForms(ctx.rent, symbol),
      })
    }
  }

  return {
    ...evidence,
    verifiable_claims: newClaims,
    context_facts: newContext,
  }
}
