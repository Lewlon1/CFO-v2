// OB-1b — estimate derivation v1 formula tests. The formula is pinned and
// mirrors the approved prototype: these tests are the spec. A failing test
// after a derive.ts edit means the edit needed a NEW engine version, not a
// green build.

import { describe, expect, it } from 'vitest'
import { type EstimateBands } from './bands'
import {
  addMonthsLabel,
  deriveEstimates,
  round10,
  type DeriveInput,
} from './derive'

// Default pick: housing b (1000) · subs low (19) · bills a (150) ·
// food out a (60) · save reach b (100). fixedBase = round10(1169) = 1170.
const bands = (over: Partial<EstimateBands> = {}): EstimateBands => ({
  housing: 'b',
  subs: 'low',
  bills: 'a',
  foodOut: 'a',
  saveReach: 'b',
  ...over,
})

const input = (over: Partial<DeriveInput> = {}): DeriveInput => ({
  income: 2000,
  bands: bands(),
  goal: null,
  ...over,
})

describe('round10 — pinned rounding', () => {
  it('rounds to the nearest 10, halves up', () => {
    expect(round10(0)).toBe(0)
    expect(round10(4)).toBe(0) // 0.4 → 0
    expect(round10(5)).toBe(10) // 0.5 → 1 (half up)
    expect(round10(14.9)).toBe(10) // 1.49 → 1
    expect(round10(15)).toBe(20) // 1.5 → 2 (half up)
    expect(round10(175)).toBe(180) // 17.5 → 18
    expect(round10(1348)).toBe(1350) // 134.8 → 135
  })
})

describe('deriveEstimates — v1 formula', () => {
  it('worked mid-range example: every field hand-computed', () => {
    // income 2100 · housing b 1000 · subs mid 48 · bills b 300 ·
    // food out b 150 · save reach c 250 · goal 5000/1000 due in 12 months.
    const r = deriveEstimates({
      income: 2100,
      bands: bands({ subs: 'mid', bills: 'b', foodOut: 'b', saveReach: 'c' }),
      goal: { targetAmount: 5000, currentAmount: 1000, monthsToDeadline: 12 },
    })

    expect(r.engine_version).toBe('v1')

    // Echoed monthly midpoints
    expect(r.housingMonthly).toBe(1000)
    expect(r.subsMonthly).toBe(48)
    expect(r.billsMonthly).toBe(300)
    expect(r.foodOutMonthly).toBe(150)
    expect(r.saveMonthly).toBe(250)

    // fixedBase = round10(1000 + 48 + 300) = round10(1348) = 1350
    expect(r.fixedBase).toBe(1350)
    // freeCash = 2100 − 1350 = 750
    expect(r.freeCash).toBe(750)
    // drift = max(0, 750 − 250 − 150) = 350
    expect(r.drift).toBe(350)
    // tight = (750 − 150) < (250 + 120) → 600 < 370 → false
    expect(r.tight).toBe(false)
    // leverAmount = min(300, round10(350 / 2)) = min(300, 180) = 180
    expect(r.leverAmount).toBe(180)

    // remaining = max(0, 5000 − 1000) = 4000
    expect(r.remaining).toBe(4000)
    // monthsAtCurrent = ceil(4000 / 250) = 16
    expect(r.monthsAtCurrent).toBe(16)
    // monthsAtBoosted = ceil(4000 / (250 + 180)) = ceil(9.30…) = 10
    expect(r.monthsAtBoosted).toBe(10)
    // payday boost lands the goal 16 − 10 = 6 months sooner
    expect(r.monthsAtCurrent! - r.monthsAtBoosted!).toBe(6)

    // save 250 ≠ 0, not tight → payday_boost; no starter amount
    expect(r.actionBranch).toBe('payday_boost')
    expect(r.starterAmount).toBeNull()

    // requiredMonthly = round10(4000 / 12) = round10(333.33…) = 330
    expect(r.requiredMonthly).toBe(330)
    // requiredPctOfIncome = round((330 / 2100) × 100) = round(15.71…) = 16
    expect(r.requiredPctOfIncome).toBe(16)
    // 16 > 50 is false → doable
    expect(r.paceVerdict).toBe('doable')
  })

  it('tight=true: lever withheld, accuracy_first branch', () => {
    // income 1500 · fixedBase 1170 → freeCash 330 · food 60 · save d 500
    // tight = (330 − 60) < (500 + 120) → 270 < 620 → true
    const r = deriveEstimates(
      input({ income: 1500, bands: bands({ saveReach: 'd' }) }),
    )
    expect(r.freeCash).toBe(330)
    // drift = max(0, 330 − 500 − 60) = 0 — the floor clamps it
    expect(r.drift).toBe(0)
    expect(r.tight).toBe(true)
    expect(r.leverAmount).toBeNull()
    expect(r.actionBranch).toBe('accuracy_first')
    expect(r.starterAmount).toBeNull()
    // goal null → all goal-derived fields null
    expect(r.remaining).toBeNull()
    expect(r.monthsAtCurrent).toBeNull()
    expect(r.monthsAtBoosted).toBeNull()
    expect(r.requiredMonthly).toBeNull()
    expect(r.requiredPctOfIncome).toBeNull()
    expect(r.paceVerdict).toBeNull()
  })

  it('tight=true with positive drift: the tight gate, not drift, withholds the lever', () => {
    // income 1400 · housing b 1000 · subs low 19 · bills a 150
    //   → fixedBase = round10(1169) = 1170 · freeCash = 1400 − 1170 = 230
    // food out a 60 · save reach b 100
    // drift = max(0, 230 − 100 − 60) = 70 — positive, so drift alone would
    //   offer a lever of min(300, round10(70 / 2)) = 40
    // tight = (230 − 60) < (100 + 120) → 170 < 220 → true
    // → leverAmount must still be null: it is the tight gate, not zero
    //   drift, that withholds it.
    const r = deriveEstimates(input({ income: 1400 }))
    expect(r.freeCash).toBe(230)
    expect(r.drift).toBe(70)
    expect(r.tight).toBe(true)
    expect(r.leverAmount).toBeNull()
    expect(r.actionBranch).toBe('accuracy_first')
    expect(r.starterAmount).toBeNull()
  })

  it('save=0 with drift=0: starter_transfer at the 100 fallback (drift/2 || 100 semantics)', () => {
    // income 1200 · fixedBase 1170 → freeCash 30 · food 60 · save a 0
    // drift = max(0, 30 − 0 − 60) = 0
    // starterAmount = max(50, round10(min(150, 0/2 || 100)))
    //   0/2 = 0 is falsy → 100 → min(150, 100) = 100 → round10 = 100 → 100
    const r = deriveEstimates({
      income: 1200,
      bands: bands({ saveReach: 'a' }),
      goal: { targetAmount: 1000, currentAmount: 0, monthsToDeadline: null },
    })
    expect(r.drift).toBe(0)
    expect(r.actionBranch).toBe('starter_transfer')
    expect(r.starterAmount).toBe(100)
    // tight = (30 − 60) < (0 + 120) → true, but save === 0 takes precedence
    expect(r.tight).toBe(true)
    expect(r.leverAmount).toBeNull()
    // save = 0 → no months-at-current even though a goal exists
    expect(r.remaining).toBe(1000)
    expect(r.monthsAtCurrent).toBeNull()
    expect(r.monthsAtBoosted).toBeNull()
    // no deadline → no pace fields
    expect(r.requiredMonthly).toBeNull()
    expect(r.requiredPctOfIncome).toBeNull()
    expect(r.paceVerdict).toBeNull()
  })

  it('save=0 with small drift: starter floor of 50', () => {
    // income 1270 · fixedBase 1170 → freeCash 100 · food 60 · save 0
    // drift = max(0, 100 − 0 − 60) = 40
    // starterAmount = max(50, round10(min(150, 20))) = max(50, 20) = 50
    const r = deriveEstimates(
      input({ income: 1270, bands: bands({ saveReach: 'a' }) }),
    )
    expect(r.drift).toBe(40)
    expect(r.actionBranch).toBe('starter_transfer')
    expect(r.starterAmount).toBe(50)
  })

  it('save=0 with big drift: starter cap of 150 and precedence over payday_boost', () => {
    // income 2000 · fixedBase 1170 → freeCash 830 · food 60 · save 0
    // drift = 770 · tight = (830 − 60) < (0 + 120) → false
    // leverAmount = min(300, round10(385)) = min(300, 390) = 300 — computed,
    // but save === 0 still wins the branch.
    // starterAmount = max(50, round10(min(150, 385))) = max(50, 150) = 150
    const r = deriveEstimates(
      input({ income: 2000, bands: bands({ saveReach: 'a' }) }),
    )
    expect(r.drift).toBe(770)
    expect(r.tight).toBe(false)
    expect(r.leverAmount).toBe(300)
    expect(r.actionBranch).toBe('starter_transfer')
    expect(r.starterAmount).toBe(150)
  })

  it('caps leverAmount at 300', () => {
    // income 3000 · housing b · subs mid · bills b → fixedBase 1350
    // freeCash 1650 · food 150 · save 250 · drift = 1250
    // round10(1250 / 2) = round10(625) = 630 → capped to 300
    const r = deriveEstimates(
      input({
        income: 3000,
        bands: bands({ subs: 'mid', bills: 'b', foodOut: 'b', saveReach: 'c' }),
      }),
    )
    expect(r.drift).toBe(1250)
    expect(r.leverAmount).toBe(300)
    expect(r.actionBranch).toBe('payday_boost')
  })

  it('goal with monthsToDeadline null: months computed, pace fields null', () => {
    const r = deriveEstimates(
      input({
        income: 2100,
        bands: bands({ subs: 'mid', bills: 'b', foodOut: 'b', saveReach: 'c' }),
        goal: { targetAmount: 5000, currentAmount: 1000, monthsToDeadline: null },
      }),
    )
    expect(r.remaining).toBe(4000)
    expect(r.monthsAtCurrent).toBe(16)
    expect(r.monthsAtBoosted).toBe(10)
    expect(r.requiredMonthly).toBeNull()
    expect(r.requiredPctOfIncome).toBeNull()
    expect(r.paceVerdict).toBeNull()
  })

  it('goal already met: remaining clamps to 0, zero months, doable pace', () => {
    const r = deriveEstimates(
      input({
        income: 2100,
        bands: bands({ subs: 'mid', bills: 'b', foodOut: 'b', saveReach: 'c' }),
        goal: { targetAmount: 1000, currentAmount: 1500, monthsToDeadline: 12 },
      }),
    )
    // remaining = max(0, 1000 − 1500) = 0
    expect(r.remaining).toBe(0)
    // ceil(0 / 250) = 0, ceil(0 / 430) = 0
    expect(r.monthsAtCurrent).toBe(0)
    expect(r.monthsAtBoosted).toBe(0)
    // requiredMonthly = round10(0 / 12) = 0 → 0% of income → doable
    expect(r.requiredMonthly).toBe(0)
    expect(r.requiredPctOfIncome).toBe(0)
    expect(r.paceVerdict).toBe('doable')
  })

  it('pace verdict boundary: exactly 50% of income is doable, 51% is steep', () => {
    // income 1000 · remaining 6000 over 12 months → requiredMonthly 500
    // → round((500 / 1000) × 100) = 50 → 50 > 50 is false → doable
    const atBoundary = deriveEstimates(
      input({
        income: 1000,
        goal: { targetAmount: 6000, currentAmount: 0, monthsToDeadline: 12 },
      }),
    )
    expect(atBoundary.requiredMonthly).toBe(500)
    expect(atBoundary.requiredPctOfIncome).toBe(50)
    expect(atBoundary.paceVerdict).toBe('doable')

    // remaining 6120 over 12 → requiredMonthly 510 → 51% → steep
    const overBoundary = deriveEstimates(
      input({
        income: 1000,
        goal: { targetAmount: 6120, currentAmount: 0, monthsToDeadline: 12 },
      }),
    )
    expect(overBoundary.requiredMonthly).toBe(510)
    expect(overBoundary.requiredPctOfIncome).toBe(51)
    expect(overBoundary.paceVerdict).toBe('steep')
  })

  it('stamps the pinned engine version on every result', () => {
    expect(deriveEstimates(input()).engine_version).toBe('v1')
  })
})

describe('addMonthsLabel — pure month arithmetic', () => {
  it('formats English month name + year', () => {
    expect(addMonthsLabel(new Date(2026, 5, 12), 4)).toBe('October 2026')
  })

  it('rolls over year boundaries', () => {
    expect(addMonthsLabel(new Date(2026, 10, 1), 14)).toBe('January 2028')
  })

  it('months=0 stays in the reference month', () => {
    expect(addMonthsLabel(new Date(2026, 5, 12), 0)).toBe('June 2026')
  })

  it('does not overflow from end-of-month reference days', () => {
    // 31 Jan + 1 month must be February, not March
    expect(addMonthsLabel(new Date(2026, 0, 31), 1)).toBe('February 2026')
  })
})
