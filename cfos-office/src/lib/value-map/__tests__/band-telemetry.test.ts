import { describe, it, expect } from 'vitest'
import { bandDeliberation, summariseBands, bandSummaryClause } from '../band-telemetry'

// Pinned v1 cutoffs: quick ≤914 · considered ≤1483 · above → took_real_thought.

describe('bandDeliberation', () => {
  it('maps the pinned percentile cutoffs', () => {
    expect(bandDeliberation(0)).toBe('quick')
    expect(bandDeliberation(914)).toBe('quick')
    expect(bandDeliberation(915)).toBe('considered')
    expect(bandDeliberation(1483)).toBe('considered')
    expect(bandDeliberation(1484)).toBe('took_real_thought')
    expect(bandDeliberation(60_000)).toBe('took_real_thought')
  })

  it('refuses to band missing or invalid telemetry', () => {
    expect(bandDeliberation(null)).toBeNull()
    expect(bandDeliberation(-5)).toBeNull()
    expect(bandDeliberation(Number.NaN)).toBeNull()
  })
})

describe('summariseBands / bandSummaryClause', () => {
  it('counts bands and hard flags independently (hard overlaps timing)', () => {
    const summary = summariseBands([
      { deliberationMs: 500, hardToDecide: false },
      { deliberationMs: 900, hardToDecide: true },
      { deliberationMs: 1200, hardToDecide: false },
      { deliberationMs: 2000, hardToDecide: true },
      { deliberationMs: null, hardToDecide: false },
    ])
    expect(summary).toEqual({
      quick: 2,
      considered: 1,
      tookRealThought: 1,
      hardToCall: 2,
      unbanded: 1,
    })
    expect(bandSummaryClause(summary)).toBe('2 quick calls, 1 considered, 1 took real thought')
  })

  it('renders singular/empty forms', () => {
    expect(
      bandSummaryClause(summariseBands([{ deliberationMs: 100, hardToDecide: false }])),
    ).toBe('1 quick call')
    expect(bandSummaryClause(summariseBands([]))).toBe('')
  })
})
