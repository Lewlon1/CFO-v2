// OB-1d — inferred-goal config (v1).
//
// The door family (door/door-config.ts) infers a starter goal so the
// estimates flow can talk pace and payback from the first screen. The user
// confirms, re-targets, or swaps it via the alt-goal escape hatch below —
// the inference is a starting point, never a commitment made for them.
//
// PINNED-CONTENT DISCIPLINE (same as estimates/bands.ts): every label, noun,
// and default below is pinned under GOAL_CONFIG_VERSION. Changing any of
// them is a NEW version, never an edit to v1.

import type { DoorFamily } from './door/door-config'

export const GOAL_CONFIG_VERSION = 'v1' as const

export type GoalCountry = 'GB' | 'ES'

export interface GoalFamilyConfig {
  /** User-facing label for the inferred goal ("working on …"). */
  inferredGoalLabel: string
  /** The short noun the CFO refers to the goal by (§5: the user's own name for it). */
  goalNoun: string
  /** Default target amount per country, in whole currency units. */
  defaultTarget: Record<GoalCountry, number>
}

/** Inferred goals start from zero saved; the user corrects it if not. */
export const GOAL_DEFAULT_CURRENT_AMOUNT = 0

export const GOAL_CONFIG: Record<DoorFamily, GoalFamilyConfig> = {
  growth: {
    inferredGoalLabel: 'getting the deposit together',
    goalNoun: 'the deposit',
    // PROVISIONAL — Lewis sign-off pending (OB plan open item #1)
    defaultTarget: { GB: 20000, ES: 20000 },
  },
  security: {
    inferredGoalLabel: 'escaping the overdraft',
    goalNoun: 'the exit pot',
    // PROVISIONAL — Lewis sign-off pending (OB plan open item #1)
    defaultTarget: { GB: 1000, ES: 1000 },
  },
  agency: {
    inferredGoalLabel: 'smoothing the months',
    goalNoun: 'the buffer',
    // PROVISIONAL — Lewis sign-off pending (OB plan open item #1)
    defaultTarget: { GB: 2500, ES: 2500 },
  },
  candor: {
    inferredGoalLabel: 'getting clarity back',
    goalNoun: 'the pot',
    // PROVISIONAL — Lewis sign-off pending (OB plan open item #1)
    defaultTarget: { GB: 1000, ES: 1000 },
  },
}

export interface DeadlineOption {
  id: '3m' | '6m' | '2y' | 'none'
  label: string
  /** Months from today; null = direction without a date. */
  months: number | null
}

export const DEADLINE_OPTIONS: readonly DeadlineOption[] = [
  { id: '3m', label: 'In 3 months', months: 3 },
  { id: '6m', label: 'Within 6 months', months: 6 },
  { id: '2y', label: 'Within 2 years', months: 24 },
  { id: 'none', label: 'No deadline — just direction', months: null },
] as const

export interface AltGoal {
  /** User-facing chip label on the escape hatch. */
  label: string
  goalNoun: string
  defaultTarget: Record<GoalCountry, number>
  /** Picking an alt re-anchors the whole flow on this family. */
  family: DoorFamily
}

/**
 * Escape hatch when the inferred goal misses. One alt per family, in family
 * order; noun and target re-anchor from GOAL_CONFIG so the two tables can
 * never disagree.
 */
export const ALT_GOALS: readonly AltGoal[] = [
  {
    label: 'A house deposit',
    family: 'growth',
    goalNoun: GOAL_CONFIG.growth.goalNoun,
    defaultTarget: GOAL_CONFIG.growth.defaultTarget,
  },
  {
    label: 'Escape the overdraft',
    family: 'security',
    goalNoun: GOAL_CONFIG.security.goalNoun,
    defaultTarget: GOAL_CONFIG.security.defaultTarget,
  },
  {
    label: 'Make the months match',
    family: 'agency',
    goalNoun: GOAL_CONFIG.agency.goalNoun,
    defaultTarget: GOAL_CONFIG.agency.defaultTarget,
  },
  {
    label: 'Stop money disappearing',
    family: 'candor',
    goalNoun: GOAL_CONFIG.candor.goalNoun,
    defaultTarget: GOAL_CONFIG.candor.defaultTarget,
  },
] as const
