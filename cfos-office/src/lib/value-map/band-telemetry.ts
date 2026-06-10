// VM-4 — telemetry banding. Raw per-card timing stops at this module's
// boundary: everything downstream (receipt templates, the reading prompt,
// any rendered UI) receives band tokens and counts only. Server-side maths
// on raw values is allowed; surfacing them is not.
//
// v1 bands: quick / considered / took_real_thought (p33/p66 deliberation
// percentiles) plus hard_to_call (the explicit hard_to_decide flag). The
// "went back and forth" band is deliberately absent — mind-changes are not
// captured by the current card UI, and we do not fake signals.

import { DELIBERATION_BANDS_MS } from './taxonomy-config'

export type DeliberationBand = 'quick' | 'considered' | 'took_real_thought'

export interface BandedCard {
  deliberationMs: number | null
  hardToDecide: boolean
}

export interface BandSummary {
  quick: number
  considered: number
  tookRealThought: number
  /** Cards explicitly flagged hard to decide (overlaps the timing bands). */
  hardToCall: number
  /** Cards with no deliberation telemetry — excluded from timing bands. */
  unbanded: number
}

export function bandDeliberation(ms: number | null): DeliberationBand | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  if (ms <= DELIBERATION_BANDS_MS.quickMax) return 'quick'
  if (ms <= DELIBERATION_BANDS_MS.consideredMax) return 'considered'
  return 'took_real_thought'
}

export function summariseBands(cards: readonly BandedCard[]): BandSummary {
  const summary: BandSummary = {
    quick: 0,
    considered: 0,
    tookRealThought: 0,
    hardToCall: 0,
    unbanded: 0,
  }
  for (const card of cards) {
    if (card.hardToDecide) summary.hardToCall += 1
    const band = bandDeliberation(card.deliberationMs)
    if (band === 'quick') summary.quick += 1
    else if (band === 'considered') summary.considered += 1
    else if (band === 'took_real_thought') summary.tookRealThought += 1
    else summary.unbanded += 1
  }
  return summary
}

/**
 * One deterministic clause for receipts and the reading prompt, e.g.
 * "7 quick calls, 2 considered, 1 took real thought". Empty string when
 * nothing was banded.
 */
export function bandSummaryClause(summary: BandSummary): string {
  const parts: string[] = []
  if (summary.quick > 0) parts.push(`${summary.quick} quick call${summary.quick === 1 ? '' : 's'}`)
  if (summary.considered > 0) parts.push(`${summary.considered} considered`)
  if (summary.tookRealThought > 0) parts.push(`${summary.tookRealThought} took real thought`)
  return parts.join(', ')
}
