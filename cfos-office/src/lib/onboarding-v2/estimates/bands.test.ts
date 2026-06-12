// OB-1b — pinned band config tests. The v1 midpoint table is the spec: a
// failing test after a bands.ts edit means the edit needed a NEW engine
// version, not a green build.

import { describe, expect, it } from 'vitest'
import {
  BILLS_BANDS,
  ESTIMATE_ENGINE_VERSION,
  FOOD_OUT_BANDS,
  HOUSING_BANDS,
  SAVE_REACH_BANDS,
  SUBS_BANDS,
  bandMidpoints,
  type EstimateBands,
} from './bands'

describe('estimate bands — v1 pinned config', () => {
  it('pins the engine version', () => {
    expect(ESTIMATE_ENGINE_VERSION).toBe('v1')
  })

  it('pins every housing midpoint', () => {
    expect(HOUSING_BANDS.a.midpoint).toBe(700)
    expect(HOUSING_BANDS.b.midpoint).toBe(1000)
    expect(HOUSING_BANDS.c.midpoint).toBe(1400)
    expect(HOUSING_BANDS.d.midpoint).toBe(1800)
  })

  it('pins every subscriptions midpoint (monthly cost per count band)', () => {
    expect(SUBS_BANDS.low.midpoint).toBe(19)
    expect(SUBS_BANDS.mid.midpoint).toBe(48)
    expect(SUBS_BANDS.high.midpoint).toBe(86)
  })

  it('pins every bills midpoint', () => {
    expect(BILLS_BANDS.a.midpoint).toBe(150)
    expect(BILLS_BANDS.b.midpoint).toBe(300)
    expect(BILLS_BANDS.c.midpoint).toBe(500)
  })

  it('pins every food-out midpoint (weekly label → MONTHLY equivalent)', () => {
    expect(FOOD_OUT_BANDS.a.midpoint).toBe(60)
    expect(FOOD_OUT_BANDS.b.midpoint).toBe(150)
    expect(FOOD_OUT_BANDS.c.midpoint).toBe(280)
  })

  it('pins every save-reach midpoint', () => {
    expect(SAVE_REACH_BANDS.a.midpoint).toBe(0)
    expect(SAVE_REACH_BANDS.b.midpoint).toBe(100)
    expect(SAVE_REACH_BANDS.c.midpoint).toBe(250)
    expect(SAVE_REACH_BANDS.d.midpoint).toBe(500)
  })

  it('gives every band a non-empty display label (currency symbol is added at render time)', () => {
    for (const config of [
      HOUSING_BANDS,
      SUBS_BANDS,
      BILLS_BANDS,
      FOOD_OUT_BANDS,
      SAVE_REACH_BANDS,
    ]) {
      for (const option of Object.values(config)) {
        expect(option.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('bandMidpoints resolves five chosen ids to their five monthly numbers', () => {
    const bands: EstimateBands = {
      housing: 'b',
      subs: 'mid',
      bills: 'b',
      foodOut: 'b',
      saveReach: 'c',
    }
    expect(bandMidpoints(bands)).toEqual({
      housingMid: 1000,
      subsMid: 48,
      billsMid: 300,
      foodOutMid: 150,
      saveReachMid: 250,
    })
  })

  it('bandMidpoints covers band-edge picks (cheapest and dearest options)', () => {
    expect(
      bandMidpoints({
        housing: 'a',
        subs: 'low',
        bills: 'a',
        foodOut: 'a',
        saveReach: 'a',
      }),
    ).toEqual({
      housingMid: 700,
      subsMid: 19,
      billsMid: 150,
      foodOutMid: 60,
      saveReachMid: 0,
    })
    expect(
      bandMidpoints({
        housing: 'd',
        subs: 'high',
        bills: 'c',
        foodOut: 'c',
        saveReach: 'd',
      }),
    ).toEqual({
      housingMid: 1800,
      subsMid: 86,
      billsMid: 500,
      foodOutMid: 280,
      saveReachMid: 500,
    })
  })
})
