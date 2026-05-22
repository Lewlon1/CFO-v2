import { describe, expect, it } from 'vitest'
import {
  IllegalTransitionError,
  isMidMarcusJourney,
  resumeRoute,
  transitionStep,
  type OnboardingStep,
} from './state-machine'

describe('transitionStep', () => {
  it('allows null → goal_chat_started', () => {
    expect(transitionStep(null, 'goal_chat_started')).toBe('goal_chat_started')
  })

  it('rejects all other transitions from null', () => {
    expect(() => transitionStep(null, 'goal_set')).toThrow(IllegalTransitionError)
    expect(() => transitionStep(null, 'value_map_started')).toThrow()
    expect(() => transitionStep(null, 'complete')).toThrow()
  })

  it('allows goal_chat_started → goal_chat_tentative | goal_set | goal_skipped', () => {
    expect(transitionStep('goal_chat_started', 'goal_chat_tentative')).toBe('goal_chat_tentative')
    expect(transitionStep('goal_chat_started', 'goal_set')).toBe('goal_set')
    expect(transitionStep('goal_chat_started', 'goal_skipped')).toBe('goal_skipped')
  })

  it('rejects goal_set → goal_chat_started (no going back)', () => {
    expect(() => transitionStep('goal_set', 'goal_chat_started')).toThrow(IllegalTransitionError)
  })

  it('allows goal_set → value_map_started', () => {
    expect(transitionStep('goal_set', 'value_map_started')).toBe('value_map_started')
  })

  it('allows goal_skipped → value_map_started', () => {
    expect(transitionStep('goal_skipped', 'value_map_started')).toBe('value_map_started')
  })

  it('allows value_map_started → value_map_done | goal_set', () => {
    expect(transitionStep('value_map_started', 'value_map_done')).toBe('value_map_done')
    // User can still set a goal mid-Value-Map (chip handler).
    expect(transitionStep('value_map_started', 'goal_set')).toBe('goal_set')
  })

  it('allows value_map_done → upload_done | complete', () => {
    expect(transitionStep('value_map_done', 'upload_done')).toBe('upload_done')
    expect(transitionStep('value_map_done', 'complete')).toBe('complete')
  })

  it('allows upload_done → archetype_shown', () => {
    expect(transitionStep('upload_done', 'archetype_shown')).toBe('archetype_shown')
  })

  it('allows archetype_shown → complete', () => {
    expect(transitionStep('archetype_shown', 'complete')).toBe('complete')
  })

  it('rejects complete → any other step (terminal)', () => {
    expect(() => transitionStep('complete', 'value_map_started')).toThrow(IllegalTransitionError)
    expect(() => transitionStep('complete', 'goal_set')).toThrow()
    expect(() => transitionStep('complete', 'archetype_shown')).toThrow()
  })

  it('IllegalTransitionError carries from/to fields', () => {
    try {
      transitionStep('goal_set', 'goal_chat_started')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError)
      const e = err as IllegalTransitionError
      expect(e.from).toBe('goal_set')
      expect(e.to).toBe('goal_chat_started')
    }
  })
})

describe('resumeRoute behaviour-preservation', () => {
  // Cases below match the old resume.ts behaviour for every (step, struggle)
  // combination the old switch handled. If any case behaves differently after
  // the refactor, this suite catches it.
  //
  // Note: the value_map_done case for chat-path users (struggle !== 'dont_know')
  // is intentionally different — see plan. Chat-path users finish onboarding at
  // the VM, so they should land back at /office, not be pushed into the
  // Marcus-only /upload flow. In practice they have onboarding_completed_at
  // set already and the office layout doesn't redirect them.

  const cases: Array<[OnboardingStep | 'intro_shown' | null, string | null, string]> = [
    // No struggle yet — always go to start
    [null, null, '/onboarding-v2'],
    ['goal_chat_started', null, '/onboarding-v2'],
    ['goal_set', null, '/onboarding-v2'],

    // null step (legacy or just-set struggle)
    [null, 'dont_know', '/onboarding-v2/value-map'],
    [null, 'debt', '/office'],
    [null, 'wealth', '/office'],
    [null, 'planning', '/office'],
    [null, 'free_text', '/office'],

    // intro_shown legacy — same as null
    ['intro_shown', 'dont_know', '/onboarding-v2/value-map'],
    ['intro_shown', 'debt', '/office'],

    // Goal chat (in flight)
    ['goal_chat_started', 'dont_know', '/office'],
    ['goal_chat_started', 'debt', '/office'],
    ['goal_chat_tentative', 'dont_know', '/office'],
    ['goal_chat_tentative', 'wealth', '/office'],

    // Goal resolved — Value Map next for all routes
    ['goal_set', 'dont_know', '/onboarding-v2/value-map'],
    ['goal_set', 'debt', '/onboarding-v2/value-map'],
    ['goal_skipped', 'dont_know', '/onboarding-v2/value-map'],
    ['goal_skipped', 'planning', '/onboarding-v2/value-map'],

    // Mid-Value Map
    ['value_map_started', 'dont_know', '/onboarding-v2/value-map'],
    ['value_map_started', 'debt', '/onboarding-v2/value-map'],

    // Value Map done — Marcus continues to upload, chat-path goes to /office
    ['value_map_done', 'dont_know', '/onboarding-v2/upload'],
    ['value_map_done', 'debt', '/office'],
    ['value_map_done', 'wealth', '/office'],

    // Upload + archetype
    ['upload_done', 'dont_know', '/onboarding-v2/archetype'],
    ['archetype_shown', 'dont_know', '/onboarding-v2/archetype'],

    // Complete — always /office
    ['complete', 'dont_know', '/office'],
    ['complete', 'debt', '/office'],
    ['complete', null, '/onboarding-v2'],
  ]

  for (const [step, struggle, expected] of cases) {
    it(`(${step ?? 'null'}, ${struggle ?? 'null'}) → ${expected}`, () => {
      expect(resumeRoute(step, struggle)).toBe(expected)
    })
  }
})

describe('isMidMarcusJourney', () => {
  it('returns false for null and goal_chat_started (pre-goal)', () => {
    expect(isMidMarcusJourney(null)).toBe(false)
    expect(isMidMarcusJourney('goal_chat_started')).toBe(false)
    expect(isMidMarcusJourney('goal_chat_tentative')).toBe(false)
  })

  it('returns true for post-goal steps through archetype_shown', () => {
    expect(isMidMarcusJourney('goal_set')).toBe(true)
    expect(isMidMarcusJourney('goal_skipped')).toBe(true)
    expect(isMidMarcusJourney('value_map_started')).toBe(true)
    expect(isMidMarcusJourney('value_map_done')).toBe(true)
    expect(isMidMarcusJourney('upload_done')).toBe(true)
    expect(isMidMarcusJourney('archetype_shown')).toBe(true)
  })

  it('returns false for complete (terminal)', () => {
    expect(isMidMarcusJourney('complete')).toBe(false)
  })
})
