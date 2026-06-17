// OB-1d — door config tests. The v1 table is the spec: a failing test after a
// door-config.ts edit means the edit needed a NEW config version, not a green
// build. (Voice guards for these strings live in ../onboarding-copy-voice.test.ts.)

import { describe, expect, it } from 'vitest'
import {
  DOOR_CONFIG,
  DOOR_CONFIG_VERSION,
  DOOR_FAMILIES,
  familyToStruggle,
  struggleToFamily,
} from './door-config'

describe('door config — v1 pinned content', () => {
  it('pins the config version', () => {
    expect(DOOR_CONFIG_VERSION).toBe('v1')
  })

  it('enumerates exactly the four families, in order', () => {
    expect(DOOR_FAMILIES).toEqual(['growth', 'security', 'agency', 'candor'])
  })

  it('has a config entry for every family', () => {
    for (const family of DOOR_FAMILIES) {
      expect(DOOR_CONFIG[family]).toBeDefined()
    }
    expect(Object.keys(DOOR_CONFIG).sort()).toEqual([...DOOR_FAMILIES].sort())
  })

  it('pins the chip situations verbatim (approved prototype)', () => {
    expect(DOOR_CONFIG.growth.situation).toBe(
      'Saving for something big — want it sooner',
    )
    expect(DOOR_CONFIG.security.situation).toBe('The overdraft keeps winning')
    expect(DOOR_CONFIG.agency.situation).toBe(
      "Income comes in lumps — months don't match",
    )
    expect(DOOR_CONFIG.candor.situation).toBe("Honestly? I've stopped looking")
  })

  it('pins the fallback reflections verbatim (approved prototype)', () => {
    expect(DOOR_CONFIG.growth.fallbackReflection).toBe(
      "Something big with a date on it — the office's favourite kind of problem.",
    )
    expect(DOOR_CONFIG.security.fallbackReflection).toBe(
      "The overdraft, then. Let's call it what it is.",
    )
    expect(DOOR_CONFIG.agency.fallbackReflection).toBe(
      'Lumpy in, steady out — a timing problem just walked in.',
    )
    expect(DOOR_CONFIG.candor.fallbackReflection).toBe(
      'Stopped looking is honest — most people lie about that one.',
    )
  })

  it('keeps every fallback reflection under 16 words', () => {
    for (const family of DOOR_FAMILIES) {
      const words = DOOR_CONFIG[family].fallbackReflection
        .split(/\s+/)
        .filter((t) => /[a-zA-Z]/.test(t))
      expect(words.length).toBeLessThan(16)
    }
  })

  it('maps families onto the existing entry_struggle enum values', () => {
    // Verified against labels.ts STRUGGLE_OPTIONS + first-read-recipe.ts:
    // the column holds dont_know | debt | wealth | planning | free_text.
    expect(DOOR_CONFIG.growth.entryStruggle).toBe('wealth')
    expect(DOOR_CONFIG.security.entryStruggle).toBe('debt')
    expect(DOOR_CONFIG.agency.entryStruggle).toBe('planning')
    expect(DOOR_CONFIG.candor.entryStruggle).toBe('dont_know')
  })

  it('familyToStruggle reads from the config table', () => {
    for (const family of DOOR_FAMILIES) {
      expect(familyToStruggle(family)).toBe(DOOR_CONFIG[family].entryStruggle)
    }
  })

  it('round-trips family → struggle → family for every family', () => {
    for (const family of DOOR_FAMILIES) {
      expect(struggleToFamily(familyToStruggle(family))).toBe(family)
    }
  })

  it('struggleToFamily returns null for free_text, unknowns, and absent values', () => {
    expect(struggleToFamily('free_text')).toBeNull()
    expect(struggleToFamily('something_else')).toBeNull()
    expect(struggleToFamily(null)).toBeNull()
    expect(struggleToFamily(undefined)).toBeNull()
    expect(struggleToFamily('')).toBeNull()
  })
})
