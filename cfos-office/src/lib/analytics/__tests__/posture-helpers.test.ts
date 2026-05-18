import { describe, it, expect } from 'vitest'
import { getTransformPosture } from '../posture-helpers'

describe('getTransformPosture', () => {
  it('returns null for null profile', () => {
    expect(getTransformPosture(null)).toBeNull()
  })

  it('returns null for stable posture regardless of confidence', () => {
    expect(
      getTransformPosture({ financial_posture: 'stable', posture_confidence: 0.95 }),
    ).toBeNull()
  })

  it('returns null for unknown posture', () => {
    expect(
      getTransformPosture({ financial_posture: 'unknown', posture_confidence: 0 }),
    ).toBeNull()
  })

  it('returns null when surviving but confidence below threshold', () => {
    expect(
      getTransformPosture({ financial_posture: 'surviving', posture_confidence: 0.75 }),
    ).toBeNull()
  })

  it('returns surviving when posture surviving and confidence ≥ 0.80', () => {
    expect(
      getTransformPosture({ financial_posture: 'surviving', posture_confidence: 0.85 }),
    ).toBe('surviving')
  })

  it('returns planning when posture planning and confidence ≥ 0.80', () => {
    expect(
      getTransformPosture({ financial_posture: 'planning', posture_confidence: 0.92 }),
    ).toBe('planning')
  })

  it('boundary: exactly 0.80 transforms', () => {
    expect(
      getTransformPosture({ financial_posture: 'planning', posture_confidence: 0.80 }),
    ).toBe('planning')
  })
})
