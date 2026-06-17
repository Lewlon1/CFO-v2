// OB-2 — estimate-flow resume resolver tests. Pins the entry-mapping order and
// the data-driven skips (door via reverse-mapped struggle, context via
// age_range, etc.) so a refactor that reorders the flow fails loudly.

import { describe, expect, it } from 'vitest'
import {
  resolveEstimateResume,
  type EstimateResumeSignals,
} from './estimate-resume'

/** A fully-empty signal set — a brand-new user. */
const EMPTY: EstimateResumeSignals = {
  doorFamily: null,
  entryStruggle: null,
  ageRange: null,
  country: null,
  compositeRelate: null,
  hasGoal: false,
  incomeMonthly: null,
  sketchBandsCount: 0,
  topValue: null,
  verdictsCount: 0,
}

/** A signal set with everything up to (but not including) `stopBefore` done. */
function through(
  overrides: Partial<EstimateResumeSignals>,
): EstimateResumeSignals {
  return { ...EMPTY, ...overrides }
}

describe('resolveEstimateResume — entry mapping', () => {
  it('routes a brand-new user to the door beat', () => {
    expect(resolveEstimateResume(EMPTY)).toBe('estimate_door')
  })

  it('treats the door as done when door_family is set', () => {
    expect(resolveEstimateResume(through({ doorFamily: 'growth' }))).toBe(
      'estimate_context',
    )
  })

  it('treats the door as done when entry_struggle reverse-maps (legacy user)', () => {
    // 'debt' → security; no door_family, but the door beat is satisfied.
    expect(resolveEstimateResume(through({ entryStruggle: 'debt' }))).toBe(
      'estimate_context',
    )
  })

  it('does NOT treat free_text entry_struggle as a completed door', () => {
    // 'free_text' has no family — the door beat must still run.
    expect(resolveEstimateResume(through({ entryStruggle: 'free_text' }))).toBe(
      'estimate_door',
    )
  })

  it('uses age_range (not country) as the context marker', () => {
    // Country pre-set by signup must NOT skip the context beat on its own.
    expect(
      resolveEstimateResume(through({ doorFamily: 'growth', country: 'GB' })),
    ).toBe('estimate_context')
    expect(
      resolveEstimateResume(
        through({ doorFamily: 'growth', country: 'GB', ageRange: '30-39' }),
      ),
    ).toBe('estimate_composite')
  })

  it('advances past the composite once a relate verdict exists', () => {
    expect(
      resolveEstimateResume(
        through({
          doorFamily: 'growth',
          ageRange: '30-39',
          compositeRelate: 'spot_on',
        }),
      ),
    ).toBe('estimate_goal')
  })

  it('advances past the goal once an active goal exists', () => {
    expect(
      resolveEstimateResume(
        through({
          doorFamily: 'growth',
          ageRange: '30-39',
          compositeRelate: 'spot_on',
          hasGoal: true,
        }),
      ),
    ).toBe('estimate_income')
  })

  it('advances past income once income is on file (estimates or profile)', () => {
    expect(
      resolveEstimateResume(
        through({
          doorFamily: 'growth',
          ageRange: '30-39',
          compositeRelate: 'spot_on',
          hasGoal: true,
          incomeMonthly: 2600,
        }),
      ),
    ).toBe('estimate_sketch')
  })

  it('stays on the sketch until all five bands are tapped', () => {
    const base = through({
      doorFamily: 'growth',
      ageRange: '30-39',
      compositeRelate: 'spot_on',
      hasGoal: true,
      incomeMonthly: 2600,
    })
    expect(resolveEstimateResume({ ...base, sketchBandsCount: 4 })).toBe(
      'estimate_sketch',
    )
    expect(resolveEstimateResume({ ...base, sketchBandsCount: 5 })).toBe(
      'estimate_verdicts',
    )
  })

  it('stays on verdicts until top value AND three verdicts are captured', () => {
    const base = through({
      doorFamily: 'growth',
      ageRange: '30-39',
      compositeRelate: 'spot_on',
      hasGoal: true,
      incomeMonthly: 2600,
      sketchBandsCount: 5,
    })
    expect(resolveEstimateResume({ ...base, topValue: null, verdictsCount: 3 })).toBe(
      'estimate_verdicts',
    )
    expect(
      resolveEstimateResume({ ...base, topValue: 'freedom', verdictsCount: 2 }),
    ).toBe('estimate_verdicts')
    expect(
      resolveEstimateResume({ ...base, topValue: 'freedom', verdictsCount: 3 }),
    ).toBe('estimate_read_pending')
  })

  it('resolves a fully-complete estimate user to the read beat', () => {
    expect(
      resolveEstimateResume({
        doorFamily: 'candor',
        entryStruggle: 'dont_know',
        ageRange: '40-49',
        country: 'ES',
        compositeRelate: 'close',
        hasGoal: true,
        incomeMonthly: 3100,
        sketchBandsCount: 5,
        topValue: 'security',
        verdictsCount: 3,
      }),
    ).toBe('estimate_read_pending')
  })
})
