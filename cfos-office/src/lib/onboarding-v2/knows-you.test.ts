// OB-1c — "C. knows you · n%" meter v1 tests. The weights are pinned and
// these tests are the spec: a failing test after a knows-you.ts edit means
// the edit needed a NEW version, not a green build.

import { describe, expect, it } from 'vitest'
import {
  KNOWS_YOU_VERSION,
  KNOWS_YOU_WEIGHTS,
  SKETCH_BANDS_MAX,
  VERDICTS_MAX,
  knowsYou,
  type KnowsYouSignals,
} from './knows-you'

const signals = (over: Partial<KnowsYouSignals> = {}): KnowsYouSignals => ({
  hasName: false,
  hasDoor: false,
  hasContext: false,
  hasCompositeRelate: false,
  hasGoal: false,
  hasIncome: false,
  sketchBandsCount: 0,
  hasTopValue: false,
  verdictsCount: 0,
  statementChecked: false,
  valueMapDone: false,
  ...over,
})

const allEstimateStage = (): KnowsYouSignals =>
  signals({
    hasName: true,
    hasDoor: true,
    hasContext: true,
    hasCompositeRelate: true,
    hasGoal: true,
    hasIncome: true,
    sketchBandsCount: 5,
    hasTopValue: true,
    verdictsCount: 3,
  })

const allTrue = (): KnowsYouSignals =>
  signals({
    ...allEstimateStage(),
    statementChecked: true,
    valueMapDone: true,
  })

describe('KNOWS_YOU_WEIGHTS — pinned totals', () => {
  it('estimate-stage weights sum to exactly 56 (the deliberate pre-statement cap)', () => {
    const w = KNOWS_YOU_WEIGHTS
    const estimateStage =
      w.name +
      w.door +
      w.context +
      w.compositeRelate +
      w.goal +
      w.income +
      w.sketchMax +
      w.topValue +
      w.verdictsMax
    expect(estimateStage).toBe(56)
  })

  it('per-unit weights times their counts equal the pinned maxima', () => {
    expect(KNOWS_YOU_WEIGHTS.sketchPerBand * 5).toBe(KNOWS_YOU_WEIGHTS.sketchMax)
    expect(KNOWS_YOU_WEIGHTS.verdictPer * 3).toBe(KNOWS_YOU_WEIGHTS.verdictsMax)
  })

  it('count ceilings derive from the weights table (single-sourced)', () => {
    expect(SKETCH_BANDS_MAX).toBe(5)
    expect(VERDICTS_MAX).toBe(3)
  })

  it('all-true total is exactly 80', () => {
    const w = KNOWS_YOU_WEIGHTS
    const total =
      w.name +
      w.door +
      w.context +
      w.compositeRelate +
      w.goal +
      w.income +
      w.sketchMax +
      w.topValue +
      w.verdictsMax +
      w.statementChecked +
      w.valueMapDone
    expect(total).toBe(80)
    expect(knowsYou(allTrue()).pct).toBe(80)
  })
})

describe('knowsYou — v1 scoring', () => {
  it('version is pinned and carried on every result', () => {
    expect(KNOWS_YOU_VERSION).toBe('v1')
    expect(knowsYou(signals()).version).toBe('v1')
    expect(knowsYou(allTrue()).version).toBe(KNOWS_YOU_VERSION)
  })

  it('nothing known scores 0', () => {
    const r = knowsYou(signals())
    expect(r.pct).toBe(0)
    expect(r.parts.every((p) => p.earned === 0)).toBe(true)
  })

  it('all estimate-stage signals score exactly 56', () => {
    expect(knowsYou(allEstimateStage()).pct).toBe(56)
  })

  it('statement check lifts 56 to 72, value map to 80', () => {
    expect(
      knowsYou(signals({ ...allEstimateStage(), statementChecked: true })).pct,
    ).toBe(72)
    expect(knowsYou(allTrue()).pct).toBe(80)
  })

  it('scores individual boolean signals at their pinned weights', () => {
    expect(knowsYou(signals({ hasName: true })).pct).toBe(4)
    expect(knowsYou(signals({ hasDoor: true })).pct).toBe(8)
    expect(knowsYou(signals({ hasContext: true })).pct).toBe(4)
    expect(knowsYou(signals({ hasCompositeRelate: true })).pct).toBe(4)
    expect(knowsYou(signals({ hasGoal: true })).pct).toBe(8)
    expect(knowsYou(signals({ hasIncome: true })).pct).toBe(8)
    expect(knowsYou(signals({ hasTopValue: true })).pct).toBe(4)
    expect(knowsYou(signals({ statementChecked: true })).pct).toBe(16)
    expect(knowsYou(signals({ valueMapDone: true })).pct).toBe(8)
  })

  it('scores sketch bands at 2 each up to 10', () => {
    expect(knowsYou(signals({ sketchBandsCount: 1 })).pct).toBe(2)
    expect(knowsYou(signals({ sketchBandsCount: 3 })).pct).toBe(6)
    expect(knowsYou(signals({ sketchBandsCount: 5 })).pct).toBe(10)
  })

  it('scores verdicts at 2 each up to 6', () => {
    expect(knowsYou(signals({ verdictsCount: 1 })).pct).toBe(2)
    expect(knowsYou(signals({ verdictsCount: 3 })).pct).toBe(6)
  })

  it('clamps out-of-range counts', () => {
    expect(knowsYou(signals({ sketchBandsCount: 7 })).pct).toBe(10)
    expect(knowsYou(signals({ sketchBandsCount: -2 })).pct).toBe(0)
    expect(knowsYou(signals({ verdictsCount: 9 })).pct).toBe(6)
    expect(knowsYou(signals({ verdictsCount: -1 })).pct).toBe(0)
  })

  it('floors fractional counts (2.5 sketched bands earns 2 × 2 = 4)', () => {
    expect(knowsYou(signals({ sketchBandsCount: 2.5 })).pct).toBe(4)
  })

  it('pct is always an integer — weights are integers, no rounding involved', () => {
    const samples: KnowsYouSignals[] = [
      signals(),
      signals({ hasName: true, sketchBandsCount: 2 }),
      signals({ hasGoal: true, verdictsCount: 1, statementChecked: true }),
      allEstimateStage(),
      allTrue(),
    ]
    for (const s of samples) {
      expect(Number.isInteger(knowsYou(s).pct)).toBe(true)
    }
  })

  it('pct equals the sum of earned across parts', () => {
    const r = knowsYou(
      signals({ hasName: true, hasIncome: true, sketchBandsCount: 4 }),
    )
    expect(r.pct).toBe(r.parts.reduce((sum, p) => sum + p.earned, 0))
    expect(r.pct).toBe(4 + 8 + 8)
  })
})

describe('knowsYou — parts breakdown', () => {
  it('returns all eleven parts in fixed order with plain-words labels', () => {
    const r = knowsYou(signals())
    expect(r.parts.map((p) => [p.key, p.label])).toEqual([
      ['name', 'your name'],
      ['door', 'what brought you in'],
      ['context', 'where life is'],
      ['composite_relate', 'how close the sketch is'],
      ['goal', 'the goal'],
      ['income', 'what lands each month'],
      ['sketch', 'your month, sketched'],
      ['top_value', 'what matters most'],
      ['verdicts', 'your verdicts'],
      ['statement_checked', 'checked against a statement'],
      ['value_map_done', 'what you value, mapped'],
    ])
  })

  it('each part carries its pinned max weight', () => {
    const weights = Object.fromEntries(
      knowsYou(signals()).parts.map((p) => [p.key, p.weight]),
    )
    expect(weights).toEqual({
      name: 4,
      door: 8,
      context: 4,
      composite_relate: 4,
      goal: 8,
      income: 8,
      sketch: 10,
      top_value: 4,
      verdicts: 6,
      statement_checked: 16,
      value_map_done: 8,
    })
  })

  it('earned never exceeds weight and reflects partial counts', () => {
    const r = knowsYou(signals({ sketchBandsCount: 3, verdictsCount: 2 }))
    for (const p of r.parts) {
      expect(p.earned).toBeGreaterThanOrEqual(0)
      expect(p.earned).toBeLessThanOrEqual(p.weight)
    }
    const sketch = r.parts.find((p) => p.key === 'sketch')
    const verdicts = r.parts.find((p) => p.key === 'verdicts')
    expect(sketch?.earned).toBe(6)
    expect(verdicts?.earned).toBe(4)
  })
})
