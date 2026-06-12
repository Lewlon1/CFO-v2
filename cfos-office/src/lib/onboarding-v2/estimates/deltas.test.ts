// OB-1c — estimate-vs-reality delta engine v1 tests. The "guess held" rule
// and the band order are pinned: these tests are the spec. A failing test
// after a deltas.ts edit means the edit needed a NEW engine version.

import { describe, expect, it } from 'vitest'
import { type EstimateBands } from './bands'
import {
  DELTA_ENGINE_VERSION,
  SAVE_REACH_PROXY_NOTE,
  computeDeltas,
  toVerificationJson,
  type BandActuals,
  type BandDelta,
} from './deltas'

// Default pick mirrors derive.test.ts: housing b (1000) · subs low (19) ·
// bills a (150) · food out a (60) · save reach b (100).
const bands = (over: Partial<EstimateBands> = {}): EstimateBands => ({
  housing: 'b',
  subs: 'low',
  bills: 'a',
  foodOut: 'a',
  saveReach: 'b',
  ...over,
})

const actuals = (over: Partial<BandActuals> = {}): BandActuals => ({
  housing: null,
  subscriptions: null,
  bills: null,
  foodOut: null,
  saveReach: null,
  ...over,
})

const byBand = (result: { bands: BandDelta[] }, key: BandDelta['band']) => {
  const found = result.bands.find((b) => b.band === key)
  if (!found) throw new Error(`band ${key} missing from result`)
  return found
}

describe('computeDeltas — structure', () => {
  it('pins the engine version', () => {
    expect(DELTA_ENGINE_VERSION).toBe('v1')
    expect(computeDeltas(bands(), actuals()).engine_version).toBe('v1')
  })

  it('always returns all five bands in fixed order, regardless of verification', () => {
    const order = ['housing', 'subscriptions', 'bills', 'food_out', 'save_reach']
    expect(computeDeltas(bands(), actuals()).bands.map((b) => b.band)).toEqual(
      order,
    )
    expect(
      computeDeltas(
        bands(),
        actuals({ saveReach: 80, bills: 200 }),
      ).bands.map((b) => b.band),
    ).toEqual(order)
  })

  it('estimates come from the OB-1b band midpoints', () => {
    const r = computeDeltas(bands(), actuals())
    expect(r.bands.map((b) => b.estimate)).toEqual([1000, 19, 150, 60, 100])
  })
})

describe('computeDeltas — all-null actuals', () => {
  it('marks everything estimated; no sharpest, no held', () => {
    const r = computeDeltas(bands(), actuals())
    expect(r.verifiedCount).toBe(0)
    expect(r.sharpest).toBeNull()
    expect(r.held).toEqual([])
    for (const b of r.bands) {
      expect(b.state).toBe('estimated')
      expect(b.actual).toBeNull()
      expect(b.delta).toBeNull()
      expect(b.held).toBeNull()
      expect(b.note).toBeNull()
    }
  })
})

describe('computeDeltas — mixed verification', () => {
  // housing 1080 → +80, held (threshold max(30, 150) = 150)
  // subscriptions 62 → +43, NOT held (threshold 30)
  // bills null → estimated
  // foodOut 58.4 → −2 (rounded), held
  // saveReach 0 → −100, NOT held
  const mixed = () =>
    computeDeltas(
      bands(),
      actuals({ housing: 1080, subscriptions: 62, foodOut: 58.4, saveReach: 0 }),
    )

  it('counts verified bands and leaves null actuals estimated', () => {
    const r = mixed()
    expect(r.verifiedCount).toBe(4)
    expect(byBand(r, 'bills').state).toBe('estimated')
    expect(byBand(r, 'bills').delta).toBeNull()
  })

  it('computes deltas as actual − estimate, rounded to whole units', () => {
    const r = mixed()
    expect(byBand(r, 'housing').delta).toBe(80)
    expect(byBand(r, 'subscriptions').delta).toBe(43)
    expect(byBand(r, 'food_out').delta).toBe(-2)
    expect(byBand(r, 'save_reach').delta).toBe(-100)
  })

  it('sharpest is the largest |delta| among NOT-held bands — held bands are ignored even with bigger deltas', () => {
    const r = mixed()
    // housing held with |80| > subscriptions' |43|, yet sharpest must come
    // from the not-held set: save_reach |−100| beats subscriptions |43|.
    expect(byBand(r, 'housing').held).toBe(true)
    expect(r.sharpest?.band).toBe('save_reach')
  })

  it('held lists exactly the verified bands where the guess held', () => {
    const r = mixed()
    expect(r.held.map((b) => b.band)).toEqual(['housing', 'food_out'])
  })
})

describe('computeDeltas — the pinned "guess held" rule: |delta| <= max(30, 0.15 × estimate)', () => {
  it('floor regime (small estimate): ±30 holds, one unit over does not', () => {
    // bills a → estimate 150; 0.15 × 150 = 22.5 < 30, so the 30 floor rules.
    const at = computeDeltas(bands(), actuals({ bills: 180 }))
    expect(byBand(at, 'bills').delta).toBe(30)
    expect(byBand(at, 'bills').held).toBe(true)

    const over = computeDeltas(bands(), actuals({ bills: 181 }))
    expect(byBand(over, 'bills').delta).toBe(31)
    expect(byBand(over, 'bills').held).toBe(false)
  })

  it('floor regime applies on the downside too', () => {
    const at = computeDeltas(bands(), actuals({ bills: 120 }))
    expect(byBand(at, 'bills').delta).toBe(-30)
    expect(byBand(at, 'bills').held).toBe(true)

    const over = computeDeltas(bands(), actuals({ bills: 119 }))
    expect(byBand(over, 'bills').held).toBe(false)
  })

  it('percentage regime (large estimate): 15% of the estimate holds, one unit over does not', () => {
    // housing d → estimate 1800; 0.15 × 1800 = 270 > 30.
    const at = computeDeltas(
      bands({ housing: 'd' }),
      actuals({ housing: 2070 }),
    )
    expect(byBand(at, 'housing').delta).toBe(270)
    expect(byBand(at, 'housing').held).toBe(true)

    const over = computeDeltas(
      bands({ housing: 'd' }),
      actuals({ housing: 2071 }),
    )
    expect(byBand(over, 'housing').delta).toBe(271)
    expect(byBand(over, 'housing').held).toBe(false)
  })

  it('zero estimate (save reach "nothing yet") still gets the 30 floor', () => {
    const r = computeDeltas(
      bands({ saveReach: 'a' }),
      actuals({ saveReach: 25 }),
    )
    expect(byBand(r, 'save_reach').estimate).toBe(0)
    expect(byBand(r, 'save_reach').held).toBe(true)
  })

  it('held is judged on the rounded delta', () => {
    // raw delta 30.4 rounds to 30 → held under the 30 floor.
    const r = computeDeltas(bands(), actuals({ bills: 180.4 }))
    expect(byBand(r, 'bills').delta).toBe(30)
    expect(byBand(r, 'bills').held).toBe(true)
  })
})

describe('computeDeltas — sharpest tie-break and edge cases', () => {
  it('breaks |delta| ties by band order (deterministic)', () => {
    // bills +40 and food_out +40, both not held (thresholds 30 and 30).
    const r = computeDeltas(bands(), actuals({ bills: 190, foodOut: 100 }))
    expect(byBand(r, 'bills').held).toBe(false)
    expect(byBand(r, 'food_out').held).toBe(false)
    expect(r.sharpest?.band).toBe('bills')
  })

  it('sharpest is null when every verified guess held', () => {
    const r = computeDeltas(bands(), actuals({ housing: 1050, bills: 160 }))
    expect(r.verifiedCount).toBe(2)
    expect(r.held.map((b) => b.band)).toEqual(['housing', 'bills'])
    expect(r.sharpest).toBeNull()
  })
})

describe('computeDeltas — save-reach proxy note', () => {
  it('verified-but-proxy stays verified and carries the pinned note', () => {
    const r = computeDeltas(
      bands(),
      actuals({ saveReach: 140, saveReachIsProxy: true }),
    )
    const sr = byBand(r, 'save_reach')
    expect(sr.state).toBe('verified')
    expect(sr.delta).toBe(40)
    expect(sr.note).toBe(SAVE_REACH_PROXY_NOTE)
    expect(SAVE_REACH_PROXY_NOTE).toBe(
      'worked out from what was left over, not from detected transfers',
    )
  })

  it('real transfers carry no note', () => {
    const r = computeDeltas(bands(), actuals({ saveReach: 140 }))
    expect(byBand(r, 'save_reach').note).toBeNull()
  })

  it('proxy flag is irrelevant when save reach is unverified', () => {
    const r = computeDeltas(bands(), actuals({ saveReachIsProxy: true }))
    const sr = byBand(r, 'save_reach')
    expect(sr.state).toBe('estimated')
    expect(sr.note).toBeNull()
  })

  it('no other band ever carries a note', () => {
    const r = computeDeltas(
      bands(),
      actuals({ housing: 2000, subscriptions: 90, bills: 400, foodOut: 300 }),
    )
    for (const b of r.bands.filter((x) => x.band !== 'save_reach')) {
      expect(b.note).toBeNull()
    }
  })
})

describe('toVerificationJson — persisted shape', () => {
  it('carries the engine version and keys bands with exactly {state, estimate, actual, delta} — no held, note, or timestamps', () => {
    const r = computeDeltas(
      bands(),
      actuals({ housing: 1080, saveReach: 140, saveReachIsProxy: true }),
    )
    const json = toVerificationJson(r)

    expect(Object.keys(json)).toEqual(['engine_version', 'bands'])
    expect(json.engine_version).toBe(DELTA_ENGINE_VERSION)
    expect(Object.keys(json.bands)).toEqual([
      'housing',
      'subscriptions',
      'bills',
      'food_out',
      'save_reach',
    ])
    expect(json.bands.housing).toEqual({
      state: 'verified',
      estimate: 1000,
      actual: 1080,
      delta: 80,
    })
    expect(json.bands.bills).toEqual({
      state: 'estimated',
      estimate: 150,
      actual: null,
      delta: null,
    })
    expect(json.bands.save_reach).toEqual({
      state: 'verified',
      estimate: 100,
      actual: 140,
      delta: 40,
    })
    for (const entry of Object.values(json.bands)) {
      expect(Object.keys(entry).sort()).toEqual([
        'actual',
        'delta',
        'estimate',
        'state',
      ])
    }
  })
})
