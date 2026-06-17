// OB-1d — voice guards over every user-facing string the door/composite/goal
// config modules introduce, plus the strings the OB-1c engines can surface
// (knows-you meter part labels, the save-reach proxy note). The CFO
// Constitution binds this copy: no advice/advise, no internal vocabulary
// (family names, layer shorthand, "archetype"), no exclamation marks, no
// emoji. Family ids are object KEYS, never display strings — these guards
// only run over what a user can read.

import { describe, expect, it } from 'vitest'
import { DOOR_CONFIG, DOOR_FAMILIES } from './door/door-config'
import {
  COMPOSITE_CARD_HEADING,
  COMPOSITE_PERSONAS,
  COMPOSITE_TRUER_PLACEHOLDER,
  COMPOSITE_TRUER_PROMPT,
  RELATE_OPTIONS,
  compositeCardLabel,
} from './composite/composite-config'
import { SAVE_REACH_PROXY_NOTE } from './estimates/deltas'
import { ALT_GOALS, DEADLINE_OPTIONS, GOAL_CONFIG } from './goal-config'
import { knowsYou } from './knows-you'

/** Every string a user can read, across the OB-1c/OB-1d modules. */
function userFacingStrings(): { source: string; text: string }[] {
  const strings: { source: string; text: string }[] = []

  for (const family of DOOR_FAMILIES) {
    strings.push({
      source: `door.${family}.situation`,
      text: DOOR_CONFIG[family].situation,
    })
    strings.push({
      source: `door.${family}.fallbackReflection`,
      text: DOOR_CONFIG[family].fallbackReflection,
    })
  }

  for (const family of DOOR_FAMILIES) {
    for (const country of ['GB', 'ES'] as const) {
      const persona = COMPOSITE_PERSONAS[family][country]
      strings.push({
        source: `composite.${persona.key}.name`,
        text: persona.name,
      })
      strings.push({
        source: `composite.${persona.key}.city`,
        text: persona.city,
      })
      persona.bullets.forEach((bullet, i) => {
        strings.push({
          source: `composite.${persona.key}.bullets[${i}]`,
          text: bullet,
        })
      })
      strings.push({
        source: `composite.${persona.key}.cardLabel`,
        text: compositeCardLabel(persona.name),
      })
    }
  }
  strings.push({ source: 'composite.heading', text: COMPOSITE_CARD_HEADING })
  strings.push({ source: 'composite.truerPrompt', text: COMPOSITE_TRUER_PROMPT })
  strings.push({
    source: 'composite.truerPlaceholder',
    text: COMPOSITE_TRUER_PLACEHOLDER,
  })
  for (const option of RELATE_OPTIONS) {
    strings.push({ source: `composite.relate.${option.id}`, text: option.label })
  }

  for (const family of DOOR_FAMILIES) {
    strings.push({
      source: `goal.${family}.inferredGoalLabel`,
      text: GOAL_CONFIG[family].inferredGoalLabel,
    })
    strings.push({
      source: `goal.${family}.goalNoun`,
      text: GOAL_CONFIG[family].goalNoun,
    })
  }
  for (const option of DEADLINE_OPTIONS) {
    strings.push({ source: `goal.deadline.${option.id}`, text: option.label })
  }
  ALT_GOALS.forEach((alt, i) => {
    strings.push({ source: `goal.alt[${i}].label`, text: alt.label })
  })

  // "C. knows you" meter part labels — rendered directly in the breakdown.
  // Signal values don't affect labels; all-false is the simplest input.
  const meterParts = knowsYou({
    hasName: false,
    hasDoor: false,
    hasContext: false,
    hasCompositeRelate: false,
    hasGoal: false,
    hasIncome: false,
    sketchBandsCount: 0,
    hasTopValue: false,
    verdictsCount: 0,
    statementChecked: false,
    valueMapDone: false,
  }).parts
  for (const part of meterParts) {
    strings.push({ source: `knowsYou.${part.key}.label`, text: part.label })
  }

  // Quoted verbatim by the reality-check Read composer — can reach the user.
  strings.push({
    source: 'deltas.saveReachProxyNote',
    text: SAVE_REACH_PROXY_NOTE,
  })

  return strings
}

describe('OB-1d copy — constitution voice guards', () => {
  const all = userFacingStrings()

  it('collects a sane corpus (guards are running over real strings)', () => {
    expect(all.length).toBeGreaterThan(60)
  })

  it('never says advice or advise', () => {
    for (const { source, text } of all) {
      expect(text, source).not.toMatch(/\b(advice|advise)\b/i)
    }
  })

  it('never says archetype', () => {
    for (const { source, text } of all) {
      expect(text, source).not.toMatch(/archetype/i)
    }
  })

  it('never uses layer shorthand (L1–L5)', () => {
    for (const { source, text } of all) {
      expect(text, source).not.toMatch(/\bL[1-5]\b/)
    }
  })

  it('never shows the internal family names as user-visible words', () => {
    for (const { source, text } of all) {
      expect(text, source).not.toMatch(/\b(growth|security|agency|candor)\b/i)
    }
  })

  it('never uses an exclamation mark', () => {
    for (const { source, text } of all) {
      expect(text, source).not.toContain('!')
    }
  })

  it('never uses emoji', () => {
    for (const { source, text } of all) {
      expect(text, source).not.toMatch(/\p{Extended_Pictographic}|️/u)
    }
  })
})
