import { describe, it, expect } from 'vitest'
import { baseConfidence } from '../confidence'

describe('baseConfidence', () => {
  it('returns 0.45 for 1 signal regardless of agreement', () => {
    expect(baseConfidence(1, 1.0)).toBe(0.45)
    expect(baseConfidence(1, 0.5)).toBe(0.45)
  })

  it('returns 0.60 for 2 signals with perfect agreement', () => {
    expect(baseConfidence(2, 1.0)).toBe(0.60)
  })

  it('returns 0.35 for 2 signals with disagreement', () => {
    expect(baseConfidence(2, 0.5)).toBe(0.35)
    expect(baseConfidence(2, 0.99)).toBe(0.35)
  })

  it('returns 0.70 for 3 signals with agreement >= 0.67', () => {
    expect(baseConfidence(3, 0.67)).toBe(0.70)
    expect(baseConfidence(3, 1.0)).toBe(0.70)
  })

  it('returns 0.40 for 3 signals with low agreement', () => {
    expect(baseConfidence(3, 0.33)).toBe(0.40)
    expect(baseConfidence(3, 0.66)).toBe(0.40)
  })

  it('scales for 4+ signals using formula', () => {
    // 4 signals, perfect agreement: 0.50 + (1.0 * 0.35) + min(0.07, 0.028) = 0.878
    expect(baseConfidence(4, 1.0)).toBe(0.88)
    // 10 signals, perfect agreement: 0.50 + 0.35 + min(0.07, 0.07) = 0.92
    expect(baseConfidence(10, 1.0)).toBe(0.92)
    // 20 signals, perfect agreement: 0.50 + 0.35 + min(0.07, 0.14) = 0.92 (capped)
    expect(baseConfidence(20, 1.0)).toBe(0.92)
  })

  it('reduces confidence for low agreement at 4+ signals', () => {
    // 5 signals, 0.6 agreement: 0.50 + (0.6 * 0.35) + min(0.07, 0.035) = 0.745
    expect(baseConfidence(5, 0.6)).toBe(0.75)
  })

  it('returns 0 for 0 signals', () => {
    expect(baseConfidence(0, 0)).toBe(0)
  })
})
