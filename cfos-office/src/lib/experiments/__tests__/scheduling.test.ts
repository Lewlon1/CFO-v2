import { describe, expect, it } from 'vitest'
import { nextSundayAt } from '../scheduling'

const OPTS = { hourUTC: 18, minDaysAhead: 1, maxDaysAhead: 7 }

describe('nextSundayAt', () => {
  it('returns next Sunday when called on a Tuesday', () => {
    // Tuesday 2026-05-05 14:00 UTC → Sunday 2026-05-10 18:00 UTC (5 days ahead).
    const result = nextSundayAt(new Date('2026-05-05T14:00:00Z'), OPTS)
    expect(result.toISOString()).toBe('2026-05-10T18:00:00.000Z')
    expect(result.getUTCDay()).toBe(0)
  })

  it('returns next Sunday (not today) when called on a Sunday', () => {
    // Sunday 2026-05-03 → next Sunday 2026-05-10. Same-day Sunday is rejected
    // by minDaysAhead=1.
    const result = nextSundayAt(new Date('2026-05-03T09:00:00Z'), OPTS)
    expect(result.toISOString()).toBe('2026-05-10T18:00:00.000Z')
  })

  it('returns the very next day when called on a Saturday', () => {
    const result = nextSundayAt(new Date('2026-05-09T23:00:00Z'), OPTS)
    expect(result.toISOString()).toBe('2026-05-10T18:00:00.000Z')
  })

  it('locks the time to hourUTC regardless of input time-of-day', () => {
    const result = nextSundayAt(new Date('2026-05-05T03:30:45Z'), { ...OPTS, hourUTC: 9 })
    expect(result.getUTCHours()).toBe(9)
    expect(result.getUTCMinutes()).toBe(0)
    expect(result.getUTCSeconds()).toBe(0)
  })

  it('throws when no Sunday exists in the requested window', () => {
    // minDaysAhead=8, maxDaysAhead=10 — no Sunday lands in a 3-day gap.
    expect(() =>
      nextSundayAt(new Date('2026-05-05T00:00:00Z'), {
        hourUTC: 18,
        minDaysAhead: 8,
        maxDaysAhead: 10,
      }),
    ).toThrow(/No Sunday/)
  })

  it('throws on a malformed window', () => {
    expect(() =>
      nextSundayAt(new Date('2026-05-05T00:00:00Z'), {
        hourUTC: 18,
        minDaysAhead: 5,
        maxDaysAhead: 2,
      }),
    ).toThrow(/Invalid window/)
  })
})
