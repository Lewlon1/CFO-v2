// OB-1d — goal config tests. The v1 labels/nouns/defaults are the spec: a
// failing test after a goal-config.ts edit means the edit needed a NEW config
// version. (Voice guards live in ./onboarding-copy-voice.test.ts.)

import { describe, expect, it } from 'vitest'
import { DOOR_FAMILIES } from './door/door-config'
import {
  ALT_GOALS,
  DEADLINE_OPTIONS,
  GOAL_CONFIG,
  GOAL_CONFIG_VERSION,
  GOAL_DEFAULT_CURRENT_AMOUNT,
} from './goal-config'

describe('goal config — v1 pinned content', () => {
  it('pins the config version', () => {
    expect(GOAL_CONFIG_VERSION).toBe('v1')
  })

  it('has a goal entry for every family', () => {
    expect(Object.keys(GOAL_CONFIG).sort()).toEqual([...DOOR_FAMILIES].sort())
  })

  it('pins the inferred goal labels and nouns', () => {
    expect(GOAL_CONFIG.growth.inferredGoalLabel).toBe(
      'getting the deposit together',
    )
    expect(GOAL_CONFIG.growth.goalNoun).toBe('the deposit')
    expect(GOAL_CONFIG.security.inferredGoalLabel).toBe(
      'escaping the overdraft',
    )
    expect(GOAL_CONFIG.security.goalNoun).toBe('the exit pot')
    expect(GOAL_CONFIG.agency.inferredGoalLabel).toBe('smoothing the months')
    expect(GOAL_CONFIG.agency.goalNoun).toBe('the buffer')
    expect(GOAL_CONFIG.candor.inferredGoalLabel).toBe('getting clarity back')
    expect(GOAL_CONFIG.candor.goalNoun).toBe('the pot')
  })

  it('pins the provisional default targets for both countries', () => {
    expect(GOAL_CONFIG.growth.defaultTarget).toEqual({ GB: 20000, ES: 20000 })
    expect(GOAL_CONFIG.security.defaultTarget).toEqual({ GB: 1000, ES: 1000 })
    expect(GOAL_CONFIG.agency.defaultTarget).toEqual({ GB: 2500, ES: 2500 })
    expect(GOAL_CONFIG.candor.defaultTarget).toEqual({ GB: 1000, ES: 1000 })
  })

  it('starts inferred goals at zero saved', () => {
    expect(GOAL_DEFAULT_CURRENT_AMOUNT).toBe(0)
  })

  it('pins the deadline options', () => {
    expect(DEADLINE_OPTIONS).toEqual([
      { id: '3m', label: 'In 3 months', months: 3 },
      { id: '6m', label: 'Within 6 months', months: 6 },
      { id: '2y', label: 'Within 2 years', months: 24 },
      { id: 'none', label: 'No deadline — just direction', months: null },
    ])
  })

  it('pins the alt-goal escape hatch labels, one per family in family order', () => {
    expect(ALT_GOALS.map((g) => g.label)).toEqual([
      'A house deposit',
      'Escape the overdraft',
      'Make the months match',
      'Stop money disappearing',
    ])
    expect(ALT_GOALS.map((g) => g.family)).toEqual([...DOOR_FAMILIES])
  })

  it('re-anchors every alt goal on its family goal config (tables can never disagree)', () => {
    for (const alt of ALT_GOALS) {
      expect(alt.goalNoun).toBe(GOAL_CONFIG[alt.family].goalNoun)
      expect(alt.defaultTarget).toEqual(GOAL_CONFIG[alt.family].defaultTarget)
    }
  })
})
