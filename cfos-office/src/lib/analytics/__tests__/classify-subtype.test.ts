import { describe, it, expect } from 'vitest'
import { classifyBillSubtype } from '../benchmark/classify-subtype'

// The low-confidence brand tokens (ee, o2, orange, three, …) used to be matched
// with a bare substring check, so unrelated merchants over-matched:
//   "Satans Coffee" → mobile   ("ee" inside "coffee")
//   "Orange Juice"  → broadband ("orange" the fruit)
//   "co2 levy"      → mobile   ("o2" inside "co2")
// The fix is word-boundary matching, plus a telco/bill context guard for the
// collision-prone brand tokens so a standalone common word ("Orange Juice",
// "O2 Arena", "Three Bears") no longer masquerades as a bill.

describe('classifyBillSubtype — low-confidence token matching', () => {
  describe('substring / standalone-word collisions are rejected (the bug)', () => {
    it('does not classify "Satans Coffee" as mobile (ee is inside coffee)', () => {
      expect(classifyBillSubtype('Satans Coffee').subtype).toBeNull()
    })

    it('does not classify "Orange Juice" as broadband (orange is a fruit here)', () => {
      expect(classifyBillSubtype('Orange Juice').subtype).toBeNull()
    })

    it('does not classify "Orange Juice Co" as broadband', () => {
      expect(classifyBillSubtype('Orange Juice Co').subtype).toBeNull()
    })

    it('does not classify "co2 levy" as mobile (o2 is inside co2)', () => {
      expect(classifyBillSubtype('co2 levy').subtype).toBeNull()
    })

    it('does not classify "O2 Arena" as mobile (venue, no telco context)', () => {
      expect(classifyBillSubtype('O2 Arena').subtype).toBeNull()
    })

    it('does not classify "Three Bears Cafe" as mobile (three is a common word)', () => {
      expect(classifyBillSubtype('Three Bears Cafe').subtype).toBeNull()
    })
  })

  describe('genuine telco labels still match at low confidence', () => {
    it('classifies "EE" as mobile when it is the whole label', () => {
      const r = classifyBillSubtype('EE')
      expect(r.subtype).toBe('mobile')
      expect(r.confidence).toBe('low')
    })

    it('classifies "EE Mobile" as mobile (telco context word present)', () => {
      const r = classifyBillSubtype('EE Mobile')
      expect(r.subtype).toBe('mobile')
      expect(r.confidence).toBe('low')
    })

    it('classifies "O2" as mobile when it is the whole label', () => {
      expect(classifyBillSubtype('O2').subtype).toBe('mobile')
    })

    it('classifies "Three Mobile" as mobile (context word present)', () => {
      expect(classifyBillSubtype('Three Mobile').subtype).toBe('mobile')
    })

    it('classifies "Vodafone" as broadband (distinctive brand, low confidence)', () => {
      const r = classifyBillSubtype('Vodafone')
      expect(r.subtype).toBe('broadband')
      expect(r.confidence).toBe('low')
    })

    it('classifies "Vodafone España" as broadband (brand as a whole word in a phrase)', () => {
      expect(classifyBillSubtype('Vodafone España').subtype).toBe('broadband')
    })
  })

  describe('generic descriptor tokens are unaffected by the collision guard', () => {
    it('classifies "Pet Insurance" as home_insurance (low)', () => {
      const r = classifyBillSubtype('Pet Insurance')
      expect(r.subtype).toBe('home_insurance')
      expect(r.confidence).toBe('low')
    })

    it('classifies "Acme Energy" as electricity (low)', () => {
      const r = classifyBillSubtype('Acme Energy')
      expect(r.subtype).toBe('electricity')
      expect(r.confidence).toBe('low')
    })
  })

  describe('high-confidence keywords keep substring matching (stems unchanged)', () => {
    it('classifies "electricity" as electricity (high) — stem "electric" still matches', () => {
      const r = classifyBillSubtype('electricity')
      expect(r.subtype).toBe('electricity')
      expect(r.confidence).toBe('high')
    })

    it('classifies "electrico" as electricity (high)', () => {
      const r = classifyBillSubtype('electrico')
      expect(r.subtype).toBe('electricity')
      expect(r.confidence).toBe('high')
    })

    it('high-confidence wins over a low-confidence brand match ("Octopus Energy")', () => {
      const r = classifyBillSubtype('Octopus Energy')
      expect(r.subtype).toBe('electricity')
      expect(r.confidence).toBe('high')
    })
  })

  describe('edge cases', () => {
    it('returns a null subtype for an empty label', () => {
      expect(classifyBillSubtype('').subtype).toBeNull()
    })

    it('returns a null subtype for null / undefined', () => {
      expect(classifyBillSubtype(null).subtype).toBeNull()
      expect(classifyBillSubtype(undefined).subtype).toBeNull()
    })
  })
})
