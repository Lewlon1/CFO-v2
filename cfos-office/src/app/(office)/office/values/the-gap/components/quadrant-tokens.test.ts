import { describe, it, expect } from 'vitest'
import {
  QUADRANT_COLOURS,
  QUADRANT_LABELS,
  formatTimeBucketLabel,
} from './quadrant-tokens'

describe('QUADRANT_COLOURS', () => {
  it('defines a colour for every quadrant including unsure', () => {
    expect(QUADRANT_COLOURS.foundation).toBeTypeOf('string')
    expect(QUADRANT_COLOURS.investment).toBeTypeOf('string')
    expect(QUADRANT_COLOURS.leak).toBeTypeOf('string')
    expect(QUADRANT_COLOURS.burden).toBeTypeOf('string')
    expect(QUADRANT_COLOURS.unsure).toBeTypeOf('string')
  })

  it('references the globals.css --gap-quadrant-* custom properties', () => {
    for (const value of Object.values(QUADRANT_COLOURS)) {
      expect(value).toMatch(/^var\(--gap-quadrant-[a-z]+\)$/)
    }
  })
})

describe('QUADRANT_LABELS', () => {
  it('renders title-cased labels for each quadrant', () => {
    expect(QUADRANT_LABELS.foundation).toBe('Foundation')
    expect(QUADRANT_LABELS.investment).toBe('Investment')
    expect(QUADRANT_LABELS.leak).toBe('Leak')
    expect(QUADRANT_LABELS.burden).toBe('Burden')
    expect(QUADRANT_LABELS.unsure).toBe('Unsure')
  })
})

describe('formatTimeBucketLabel', () => {
  it('humanises known time-context bucket keys', () => {
    expect(formatTimeBucketLabel('weekday_late')).toBe('Weekday late')
    expect(formatTimeBucketLabel('weekday_midday')).toBe('Weekday midday')
    expect(formatTimeBucketLabel('weekend_evening')).toBe('Weekend evening')
    expect(formatTimeBucketLabel('weekday_early')).toBe('Weekday early')
    expect(formatTimeBucketLabel('weekend_morning')).toBe('Weekend morning')
  })

  it('passes through unknown bucket keys unchanged', () => {
    // Defensive fallback — if the analyser ever emits a new bucket key,
    // we render the raw key rather than crashing.
    expect(formatTimeBucketLabel('mystery_bucket')).toBe('mystery_bucket')
  })
})
