import { describe, it, expect } from 'vitest'
import {
  classify,
  verdictCredit,
  computeAgreement,
  bootstrapCI,
  checkPromotion,
  type AgreementResult,
} from './agreement'

describe('classify', () => {
  it('returns match when both pick the same side', () => {
    expect(classify('a', 'a')).toBe('match')
    expect(classify('b', 'b')).toBe('match')
    expect(classify('tie', 'tie')).toBe('match')
  })

  it('returns half_match when exactly one says tie', () => {
    expect(classify('a', 'tie')).toBe('half_match')
    expect(classify('tie', 'a')).toBe('half_match')
    expect(classify('b', 'tie')).toBe('half_match')
    expect(classify('tie', 'b')).toBe('half_match')
  })

  it('returns miss when opposing non-tie picks', () => {
    expect(classify('a', 'b')).toBe('miss')
    expect(classify('b', 'a')).toBe('miss')
  })
})

describe('verdictCredit', () => {
  it('match=1, half_match=0.5, miss=0', () => {
    expect(verdictCredit('match')).toBe(1)
    expect(verdictCredit('half_match')).toBe(0.5)
    expect(verdictCredit('miss')).toBe(0)
  })
})

describe('computeAgreement', () => {
  it('returns zero state for empty input', () => {
    const r = computeAgreement([])
    expect(r.count).toBe(0)
    expect(r.agreement).toBe(0)
    expect(r.matches).toBe(0)
  })

  it('agreement = 1 when judge picks Lewis every time', () => {
    const r = computeAgreement([
      { lewis: 'a', judge: 'a' },
      { lewis: 'b', judge: 'b' },
      { lewis: 'a', judge: 'a' },
    ])
    expect(r.matches).toBe(3)
    expect(r.agreement).toBe(1)
  })

  it('agreement = 0 when judge always opposes Lewis', () => {
    const r = computeAgreement([
      { lewis: 'a', judge: 'b' },
      { lewis: 'b', judge: 'a' },
    ])
    expect(r.misses).toBe(2)
    expect(r.agreement).toBe(0)
  })

  it('half credit for tie/non-tie pairs', () => {
    const r = computeAgreement([
      { lewis: 'a', judge: 'a' },
      { lewis: 'a', judge: 'tie' },
    ])
    expect(r.matches).toBe(1)
    expect(r.half_matches).toBe(1)
    expect(r.agreement).toBe(0.75) // (1 + 0.5) / 2
  })

  it('full credit when both say tie', () => {
    const r = computeAgreement([
      { lewis: 'tie', judge: 'tie' },
      { lewis: 'a', judge: 'a' },
    ])
    expect(r.matches).toBe(2)
    expect(r.agreement).toBe(1)
  })

  it('attaches CI when bootstrap > 0', () => {
    const r = computeAgreement(
      [
        { lewis: 'a', judge: 'a' },
        { lewis: 'b', judge: 'b' },
        { lewis: 'a', judge: 'b' },
        { lewis: 'b', judge: 'a' },
      ],
      { bootstrap: 200 },
    )
    expect(r.ci95).toBeDefined()
    expect(r.ci95!.low).toBeLessThanOrEqual(r.agreement)
    expect(r.ci95!.high).toBeGreaterThanOrEqual(r.agreement)
  })
})

describe('bootstrapCI', () => {
  it('is deterministic given the same seed', () => {
    const credits = [1, 1, 0, 0.5, 1, 0, 1]
    const a = bootstrapCI(credits, 500, 42)
    const b = bootstrapCI(credits, 500, 42)
    expect(a).toEqual(b)
  })

  it('low <= high', () => {
    const credits = [1, 0, 0.5, 1, 0]
    const r = bootstrapCI(credits, 200, 7)
    expect(r.low).toBeLessThanOrEqual(r.high)
  })

  it('low = 0 high = 0 for empty input', () => {
    expect(bootstrapCI([], 100)).toEqual({ low: 0, high: 0 })
  })
})

describe('checkPromotion', () => {
  const champ = (train: number, holdout: number, ciLow: number, ciHigh: number): AgreementResult => ({
    count: 30,
    matches: 0,
    half_matches: 0,
    misses: 0,
    agreement: train,
    ci95: { low: ciLow, high: ciHigh },
  })

  // Wrap into the (train, holdout) shape checkPromotion expects.
  function pair(train: number, holdout: number, ciLow = 0, ciHigh = 1) {
    return { train: { ...champ(train, 0, 0, 1), agreement: train }, holdout: { ...champ(0, holdout, ciLow, ciHigh), agreement: holdout } }
  }

  it('rejects when train improvement is below minDelta', () => {
    const decision = checkPromotion({
      champion: pair(0.7, 0.7),
      candidate: pair(0.71, 0.8, 0.75, 0.85),
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toMatch(/train/)
  })

  it('rejects when holdout improvement is below minDelta', () => {
    const decision = checkPromotion({
      champion: pair(0.7, 0.7),
      candidate: pair(0.75, 0.71, 0.65, 0.8),
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toMatch(/holdout/)
  })

  it('rejects when candidate CI lower bound does not exceed champion point', () => {
    const decision = checkPromotion({
      champion: pair(0.7, 0.7),
      candidate: pair(0.8, 0.75, 0.65, 0.85), // CI low 0.65 < champion 0.70
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toMatch(/CI lower bound/)
  })

  it('accepts when all three conditions pass', () => {
    const decision = checkPromotion({
      champion: pair(0.7, 0.7),
      candidate: pair(0.8, 0.8, 0.75, 0.88),
    })
    expect(decision.eligible).toBe(true)
  })

  it('respects custom minDelta', () => {
    const decision = checkPromotion({
      champion: pair(0.7, 0.7),
      candidate: pair(0.71, 0.71, 0.705, 0.72),
      minDelta: 0.005, // very permissive
    })
    expect(decision.eligible).toBe(true)
  })
})
