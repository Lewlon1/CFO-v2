// OB-2 — door classifier gauntlet tests. Pure validation only (no live Bedrock):
// the gauntlet is the trust boundary, so every degradation path is pinned.

import { describe, expect, it } from 'vitest'
import { DOOR_CONFIG } from './door-config'
import {
  isValidReflection,
  validateDoorOutput,
} from './classify-door'

describe('validateDoorOutput — happy path', () => {
  it('accepts well-formed JSON with a valid family, confidence, and voice line', () => {
    const out = validateDoorOutput(
      '{"family":"growth","confidence":0.82,"reflection":"A deposit with a date on it — my favourite problem."}',
    )
    expect(out).toEqual({
      status: 'classified',
      family: 'growth',
      confidence: 0.82,
      reflection: 'A deposit with a date on it — my favourite problem.',
    })
  })

  it('tolerates code fences around the JSON', () => {
    const out = validateDoorOutput(
      '```json\n{"family":"security","confidence":0.9,"reflection":"The overdraft, then. Lets name it."}\n```',
    )
    expect(out.status).toBe('classified')
    if (out.status === 'classified') expect(out.family).toBe('security')
  })

  it('isolates the object when the model adds stray prose', () => {
    const out = validateDoorOutput(
      'Here you go: {"family":"agency","confidence":0.7,"reflection":"Lumpy in, steady out — a timing problem."} hope that helps',
    )
    expect(out.status).toBe('classified')
    if (out.status === 'classified') expect(out.family).toBe('agency')
  })
})

describe('validateDoorOutput — fallback path', () => {
  it('falls back on unparseable output', () => {
    expect(validateDoorOutput('not json at all').status).toBe('fallback')
  })

  it('falls back on an unknown family', () => {
    const out = validateDoorOutput('{"family":"wealth","confidence":0.9,"reflection":"x y z"}')
    expect(out).toMatchObject({ status: 'fallback', reason: 'bad_family' })
  })

  it('falls back on a confidence out of range', () => {
    expect(validateDoorOutput('{"family":"growth","confidence":1.4,"reflection":"a b"}')).toMatchObject({
      status: 'fallback',
      reason: 'bad_confidence',
    })
  })

  it('falls back on low confidence (< 0.6)', () => {
    expect(validateDoorOutput('{"family":"candor","confidence":0.4,"reflection":"a b"}')).toMatchObject({
      status: 'fallback',
      reason: 'low_confidence',
    })
  })

  it('falls back on a non-number confidence', () => {
    expect(validateDoorOutput('{"family":"growth","confidence":"high","reflection":"a b"}').status).toBe(
      'fallback',
    )
  })
})

describe('validateDoorOutput — reflection degradation', () => {
  it('uses the deterministic fallback line when the LLM line fails the voice gate', () => {
    // Valid family + confidence, but the reflection has an exclamation mark.
    const out = validateDoorOutput(
      '{"family":"candor","confidence":0.8,"reflection":"You stopped looking!"}',
    )
    expect(out.status).toBe('classified')
    if (out.status === 'classified') {
      expect(out.family).toBe('candor')
      expect(out.reflection).toBe(DOOR_CONFIG.candor.fallbackReflection)
    }
  })

  it('uses the deterministic fallback when the LLM line is too long', () => {
    const longLine = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ')
    const out = validateDoorOutput(
      `{"family":"growth","confidence":0.8,"reflection":"${longLine}"}`,
    )
    if (out.status === 'classified') {
      expect(out.reflection).toBe(DOOR_CONFIG.growth.fallbackReflection)
    } else {
      throw new Error('expected classified')
    }
  })
})

describe('isValidReflection', () => {
  it('rejects questions, exclamations, emoji, banned phrases, and over-length', () => {
    expect(isValidReflection('Is that you?')).toBe(false)
    expect(isValidReflection('That is bold!')).toBe(false)
    expect(isValidReflection('Nice work 🎉')).toBe(false)
    expect(isValidReflection('I think you should save')).toBe(false)
    expect(isValidReflection('Here is some advice for you today')).toBe(false)
    expect(isValidReflection('')).toBe(false)
    expect(isValidReflection(Array.from({ length: 20 }, () => 'x').join(' '))).toBe(false)
  })

  it('accepts a clean declarative line', () => {
    expect(isValidReflection('The overdraft, then. Let us name it.')).toBe(true)
  })
})
