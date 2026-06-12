// OB-1d — door taxonomy config (v1).
//
// The estimates-first onboarding opens with a door question ("what brings you
// into the office?"). Free text is LLM-classified into one of four INTERNAL
// families — growth, security, agency, candor — which are never shown to
// users. The family selects the composite-persona introduction card
// (composite/composite-config.ts), the inferred goal (../goal-config.ts), and
// the deterministic fallback reflection below.
//
// DELIBERATELY SEPARATE from value-map/taxonomy-config.ts. That module is the
// post-statement, behavioural archetype taxonomy (family × certainty,
// classified from Value Map card sorts). This module is the pre-statement
// door taxonomy, classified from one line of free text before any data
// exists. The family ids coincide by name — that is intentional thematic
// rhyme, not shared vocabulary. Neither module imports the other's types;
// recalibrating one never moves the other.
//
// PINNED-CONTENT DISCIPLINE (same as estimates/bands.ts): every string and
// mapping below is pinned under DOOR_CONFIG_VERSION. Changing any of them is
// a NEW version, never an edit to v1 — persisted door classifications record
// the version they were made under.

export const DOOR_CONFIG_VERSION = 'v1' as const

export type DoorFamily = 'growth' | 'security' | 'agency' | 'candor'

export const DOOR_FAMILIES: readonly DoorFamily[] = [
  'growth',
  'security',
  'agency',
  'candor',
] as const

/**
 * The existing user_profiles.entry_struggle values (see
 * onboarding-v2/labels.ts STRUGGLE_OPTIONS and selectReadRecipe in
 * ai/first-read-recipe.ts). 'free_text' also exists in that column but has no
 * family of its own — free text is what the door classifier consumes.
 */
export type DoorEntryStruggle = 'wealth' | 'debt' | 'planning' | 'dont_know'

export interface DoorFamilyConfig {
  /** User-facing chip text on the door screen (approved prototype, verbatim). */
  situation: string
  /**
   * Deterministic reflection shown when the LLM-generated line fails
   * validation. C.'s voice: under 16 words, declarative, no exclamation
   * marks, no emoji.
   */
  fallbackReflection: string
  /** Mapped existing entry_struggle enum value (downstream Read recipes key off this). */
  entryStruggle: DoorEntryStruggle
}

export const DOOR_CONFIG: Record<DoorFamily, DoorFamilyConfig> = {
  growth: {
    situation: 'Saving for something big — want it sooner',
    fallbackReflection:
      "Something big with a date on it — the office's favourite kind of problem.",
    entryStruggle: 'wealth',
  },
  security: {
    situation: 'The overdraft keeps winning',
    fallbackReflection: "The overdraft, then. Let's call it what it is.",
    entryStruggle: 'debt',
  },
  agency: {
    situation: "Income comes in lumps — months don't match",
    fallbackReflection: 'Lumpy in, steady out — a timing problem just walked in.',
    entryStruggle: 'planning',
  },
  candor: {
    situation: "Honestly? I've stopped looking",
    fallbackReflection:
      'Stopped looking is honest — most people lie about that one.',
    entryStruggle: 'dont_know',
  },
}

/** Family → existing entry_struggle value (what the door writes to the profile). */
export function familyToStruggle(family: DoorFamily): DoorEntryStruggle {
  return DOOR_CONFIG[family].entryStruggle
}

/**
 * Reverse mapping, for resuming users who answered the OLD struggle beat
 * before the door existed. Accepts the raw entry_struggle column value;
 * returns null for 'free_text', unknown values, and null/undefined — callers
 * fall through to the door question in that case.
 */
export function struggleToFamily(
  struggle: string | null | undefined,
): DoorFamily | null {
  switch (struggle) {
    case 'wealth':
      return 'growth'
    case 'debt':
      return 'security'
    case 'planning':
      return 'agency'
    case 'dont_know':
      return 'candor'
    default:
      return null
  }
}
