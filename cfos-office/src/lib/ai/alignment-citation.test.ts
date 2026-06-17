// VM-5 — the alignment citation honesty gate. Below the display floor the
// CFO's context receives NOTHING about alignment: the user's dashboard shows
// a calibrating state, and C. must never discuss a number the user can't
// see. These tests pin that gate and the computed (never narrated) delta.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAlignmentCitation } from './context-builder'

const snap = (
  month: string,
  pct: number | null,
  confidence: number | null,
) => ({
  month,
  aligned_spend_pct: pct,
  alignment_confidence: confidence,
})

describe('buildAlignmentCitation', () => {
  beforeEach(() => {
    vi.stubEnv('VALUE_MAP_V2', '1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns empty when the flag is off, regardless of data', () => {
    vi.stubEnv('VALUE_MAP_V2', '0')
    expect(buildAlignmentCitation([snap('2026-05-01', 78, 0.9)])).toBe('')
  })

  it('returns empty below the display floor — a fresh profile injects nothing', () => {
    expect(buildAlignmentCitation([snap('2026-05-01', 78, 0.39)])).toBe('')
    expect(buildAlignmentCitation([snap('2026-05-01', 78, 0)])).toBe('')
    expect(buildAlignmentCitation([snap('2026-05-01', null, 0.9)])).toBe('')
    expect(buildAlignmentCitation([])).toBe('')
  })

  it('cites score and coverage above the floor, as whole percentages', () => {
    const out = buildAlignmentCitation([snap('2026-05-01', 77.5891, 0.5512)])
    expect(out).toContain('Alignment score: 78%')
    expect(out).toContain('Coverage: 55%')
    expect(out).toContain('never praise or judgement')
  })

  it('computes the 3-month delta when that month exists and also cleared the floor', () => {
    const out = buildAlignmentCitation([
      snap('2026-05-01', 78.2, 0.6),
      snap('2026-04-01', 74, 0.55),
      snap('2026-03-01', 71.4, 0.5),
      snap('2026-02-01', 70, 0.41),
    ])
    expect(out).toContain('3-month change: +8 percentage points since February (70% → 78%)')
  })

  it('omits the delta when the comparison month was below the floor — never anchor on a number the user was not shown', () => {
    const out = buildAlignmentCitation([
      snap('2026-05-01', 78, 0.6),
      snap('2026-02-01', 71, 0.2),
    ])
    expect(out).toContain('Alignment score: 78%')
    expect(out).not.toContain('3-month change')
  })

  it('omits the delta when the 3-months-prior snapshot is missing (gap month)', () => {
    const out = buildAlignmentCitation([
      snap('2026-05-01', 78, 0.6),
      snap('2026-01-01', 60, 0.6), // 4 months back, not 3
    ])
    expect(out).not.toContain('3-month change')
  })

  it('handles the year boundary in the 3-month lookback', () => {
    const out = buildAlignmentCitation([
      snap('2026-01-01', 64, 0.6),
      snap('2025-10-01', 70, 0.6),
    ])
    expect(out).toContain('3-month change: -6 percentage points since October (70% → 64%)')
  })
})
