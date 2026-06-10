import { describe, it, expect } from 'vitest'
import { classifyArchetype, type AnsweredCard } from '../classify-archetype'
import legacySessions from './fixtures/legacy-sessions.json'

// Hand-computed against the pinned v1 constants:
//   base rates  foundation .4628 · investment .29 · burden .1702 · leak .0769
//   medians     avgConfidence 3.0 (sd .1934) · hardRate 0 (sd 0, degenerate
//               guard → z +2 when any card is hard) · deliberation 1208.5ms
//               (sd 477.8)
//   bands       quick ≤914 · considered ≤1483
//   fallback    <6 cards, or max ratio <1.25

function card(
  quadrant: AnsweredCard['quadrant'],
  overrides: Partial<AnsweredCard> = {},
): AnsweredCard {
  return { quadrant, confidence: 3, hardToDecide: false, deliberationMs: 1208, ...overrides }
}

/** n cards of one quadrant with shared telemetry. */
function cards(
  quadrant: AnsweredCard['quadrant'],
  n: number,
  overrides: Partial<AnsweredCard> = {},
): AnsweredCard[] {
  return Array.from({ length: n }, () => card(quadrant, overrides))
}

// Telemetry profiles. CERTAIN: conf 4 → z = (4−3)/.1934 = +5.171; delib 800
// → z = (800−1208.5)/477.8 = −0.855; composite = 5.171 − 0 − (−0.855) > 0.
// EXPLORING: conf 3 → z 0; delib 2000 → z = +1.6566; composite = −1.6566 < 0.
const CERTAIN = { confidence: 4, deliberationMs: 800 }
const EXPLORING = { confidence: 3, deliberationMs: 2000 }

describe('classifyArchetype — family assignment (all 8 cells)', () => {
  // growth: 5 inv (.5/.29 = 1.7241) beats 5 found (.5/.4628 = 1.0804)
  const growthMix = (t: Partial<AnsweredCard>) => [
    ...cards('investment', 5, t),
    ...cards('foundation', 5, t),
  ]
  // security: 8 found (.8/.4628 = 1.7286) beats 2 inv (.2/.29 = 0.6897)
  const securityMix = (t: Partial<AnsweredCard>) => [
    ...cards('foundation', 8, t),
    ...cards('investment', 2, t),
  ]
  // agency: 4 burden (.4/.1702 = 2.3502) beats 6 found (.6/.4628 = 1.2965)
  const agencyMix = (t: Partial<AnsweredCard>) => [
    ...cards('burden', 4, t),
    ...cards('foundation', 6, t),
  ]
  // candor: 3 leak (.3/.0769 = 3.9012) beats 7 found (.7/.4628 = 1.5125)
  const candorMix = (t: Partial<AnsweredCard>) => [
    ...cards('leak', 3, t),
    ...cards('foundation', 7, t),
  ]

  it.each([
    ['growth', 'certain', 'The Builder', growthMix(CERTAIN)],
    ['growth', 'exploring', 'The Scout', growthMix(EXPLORING)],
    ['security', 'certain', 'The Fortress', securityMix(CERTAIN)],
    ['security', 'exploring', 'The Nester', securityMix(EXPLORING)],
    ['agency', 'certain', 'The Negotiator', agencyMix(CERTAIN)],
    ['agency', 'exploring', 'The Restless', agencyMix(EXPLORING)],
    ['candor', 'certain', 'The Editor', candorMix(CERTAIN)],
    ['candor', 'exploring', 'The Drifter', candorMix(EXPLORING)],
  ] as const)('%s / %s → %s', (family, certainty, displayName, mix) => {
    const result = classifyArchetype(mix)
    expect(result.usedFallback).toBe(false)
    expect(result.family).toBe(family)
    expect(result.certainty).toBe(certainty)
    expect(result.displayName).toBe(displayName)
    expect(result.taxonomyVersion).toBe('v1')
  })

  it('computes the receipt working for the growth/certain case', () => {
    const result = classifyArchetype(growthMix(CERTAIN))
    expect(result.receipt.answeredCards).toBe(10)
    expect(result.receipt.countsByQuadrant.investment).toBe(5)
    expect(result.receipt.ratiosByQuadrant.investment).toBeCloseTo(1.7241, 3)
    expect(result.receipt.winningQuadrant).toBe('investment')
    // 1.6 ≤ 1.7241 < 2.5 → 'about twice the typical rate'
    expect(result.receipt.ratioPhrase).toBe('about twice the typical rate')
    expect(result.receipt.certainty.zConfidence).toBeCloseTo(5.1706, 3)
    expect(result.receipt.certainty.zDeliberation).toBeCloseTo(-0.855, 3)
    expect(result.receipt.certainty.composite).toBeGreaterThan(0)
    // All 10 cards at 800ms → quick band
    expect(result.receipt.bands.quick).toBe(10)
  })
})

describe('classifyArchetype — certainty composite details', () => {
  it('hard_to_decide cards push toward exploring via the degenerate-spread guard (+2)', () => {
    // conf 4 everywhere (z +5.171), delib 800 (−z +0.855) but 3/10 hard:
    // zHard = +2 (sd 0 guard) → composite = 5.171 − 2 + 0.855 > 0 still
    // certain; crank deliberation to 2400 (z +2.4936) → composite =
    // 5.171 − 2 − 2.4936 = +0.677 → still certain; conf 3.1 (z +0.517):
    // 0.517 − 2 − 2.4936 < 0 → exploring.
    const mix = [
      ...Array.from({ length: 3 }, () =>
        card('foundation', { confidence: 3.1, deliberationMs: 2400, hardToDecide: true }),
      ),
      ...cards('foundation', 5, { confidence: 3.1, deliberationMs: 2400 }),
      ...cards('investment', 2, { confidence: 3.1, deliberationMs: 2400 }),
    ]
    const result = classifyArchetype(mix)
    expect(result.family).toBe('security')
    expect(result.receipt.certainty.zHardRate).toBe(2)
    expect(result.certainty).toBe('exploring')
  })

  it('missing deliberation telemetry contributes zero, not a fake speed signal', () => {
    const mix = securityNoTelemetry()
    const result = classifyArchetype(mix)
    expect(result.receipt.certainty.medianDeliberationMs).toBeNull()
    expect(result.receipt.certainty.zDeliberation).toBe(0)
    expect(result.receipt.bands.unbanded).toBe(8)
  })

  function securityNoTelemetry(): AnsweredCard[] {
    return [
      ...cards('foundation', 7, { deliberationMs: null }),
      ...cards('investment', 1, { deliberationMs: null }),
    ]
  }
})

describe('classifyArchetype — fallback triggers', () => {
  it('fewer than 6 answered cards → unnamed fallback (too_few_cards)', () => {
    const result = classifyArchetype(cards('leak', 5, CERTAIN))
    expect(result.usedFallback).toBe(true)
    expect(result.family).toBeNull()
    expect(result.certainty).toBeNull()
    expect(result.displayName).toBeNull()
    expect(result.receipt.fallbackReason).toBe('too_few_cards')
  })

  it('flat ratios (max < 1.25) → unnamed fallback (flat_ratios)', () => {
    // 5 found (1.0804), 3 inv (1.0345), 2 burden (1.1751), 0 leak → max 1.1751
    const mix = [
      ...cards('foundation', 5),
      ...cards('investment', 3),
      ...cards('burden', 2),
    ]
    const result = classifyArchetype(mix)
    expect(result.usedFallback).toBe(true)
    expect(result.family).toBeNull()
    expect(result.displayName).toBeNull()
    expect(result.receipt.fallbackReason).toBe('flat_ratios')
    expect(result.receipt.winningRatio).toBeCloseTo(1.1751, 3)
  })

  it('zero answered cards → fallback with a complete, non-crashing receipt', () => {
    const result = classifyArchetype([])
    expect(result.usedFallback).toBe(true)
    expect(result.receipt.fallbackReason).toBe('too_few_cards')
    expect(result.receipt.answeredCards).toBe(0)
  })
})

describe('classifyArchetype — legacy session sanity (cross-distribution)', () => {
  // Sanity, NOT assertion (the legacy types were LLM/deterministic-v0
  // labels): expectation is that legacy 'builder' skews growth and
  // 'fortress' skews security; 'anchor' lands wherever v1 puts it. The
  // table is reported in SESSION-LOG.
  it('classifies every legacy session without error and logs the table', () => {
    const table: Record<string, Record<string, number>> = {}
    for (const session of legacySessions as Array<{
      legacy_type: string
      cards: Array<{ quadrant: string; confidence: number; hard: boolean; delib: number | null }>
    }>) {
      const result = classifyArchetype(
        session.cards.map((c) => ({
          quadrant: c.quadrant as AnsweredCard['quadrant'],
          confidence: c.confidence,
          hardToDecide: c.hard,
          deliberationMs: c.delib,
        })),
      )
      expect(result.taxonomyVersion).toBe('v1')
      const cell = result.displayName ?? 'unnamed fallback'
      table[session.legacy_type] ??= {}
      table[session.legacy_type][cell] = (table[session.legacy_type][cell] ?? 0) + 1
    }
    console.log('[VM-4 sanity] legacy → v1 cross-distribution:', JSON.stringify(table, null, 2))
    expect(Object.keys(table).sort()).toEqual(['anchor', 'builder', 'fortress'])
  })
})
