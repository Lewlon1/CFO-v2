import { describe, it, expect } from 'vitest'
import {
  VALUE_DISPLAY_CONFIDENCE_THRESHOLD,
  RULE_APPLICATION_MIN_CONFIDENCE,
  DEFAULT_SOURCE_CONFIDENCE_CAP,
  SUPPRESSED_DEFAULT_CONFIDENCE,
  CARD_CONF_TO_RULE_CONF,
  cardConvictionToRuleConfidence,
  isValueDisplayable,
  emittableDefaultCategory,
  gateDefaultEmission,
} from './value-config'

describe('isValueDisplayable', () => {
  it('always displays user-confirmed labels, regardless of confidence', () => {
    expect(
      isValueDisplayable({ value_category: 'leak', value_confidence: 0.1, value_confirmed_by_user: true })
    ).toBe(true)
  })

  it('displays unconfirmed labels at or above the threshold', () => {
    expect(
      isValueDisplayable({
        value_category: 'foundation',
        value_confidence: VALUE_DISPLAY_CONFIDENCE_THRESHOLD,
        value_confirmed_by_user: false,
      })
    ).toBe(true)
  })

  it('hides unconfirmed labels below the threshold', () => {
    expect(
      isValueDisplayable({ value_category: 'leak', value_confidence: 0.59, value_confirmed_by_user: false })
    ).toBe(false)
    expect(
      isValueDisplayable({ value_category: 'foundation', value_confidence: null, value_confirmed_by_user: false })
    ).toBe(false)
  })

  it("never displays 'unsure', legacy 'no_idea', or null as a value label", () => {
    expect(
      isValueDisplayable({ value_category: 'unsure', value_confidence: 0.9, value_confirmed_by_user: false })
    ).toBe(false)
    expect(
      isValueDisplayable({ value_category: 'no_idea', value_confidence: 0.9, value_confirmed_by_user: true })
    ).toBe(false)
    expect(
      isValueDisplayable({ value_category: null, value_confidence: 0.9, value_confirmed_by_user: true })
    ).toBe(false)
  })
})

describe('emittableDefaultCategory', () => {
  it('passes foundation / burden / investment through', () => {
    expect(emittableDefaultCategory('foundation')).toBe('foundation')
    expect(emittableDefaultCategory('burden')).toBe('burden')
    expect(emittableDefaultCategory('investment')).toBe('investment')
  })

  it("rejects 'leak', 'unsure', retired 'no_idea', null, and unknowns", () => {
    expect(emittableDefaultCategory('leak')).toBeNull()
    expect(emittableDefaultCategory('unsure')).toBeNull()
    expect(emittableDefaultCategory('no_idea')).toBeNull()
    expect(emittableDefaultCategory(null)).toBeNull()
    expect(emittableDefaultCategory(undefined)).toBeNull()
    expect(emittableDefaultCategory('wasteful')).toBeNull()
  })
})

describe('gateDefaultEmission', () => {
  it('caps emittable default confidence at the source cap', () => {
    expect(gateDefaultEmission('foundation', 0.6)).toEqual({
      valueCategory: 'foundation',
      confidence: DEFAULT_SOURCE_CONFIDENCE_CAP,
    })
    expect(gateDefaultEmission('burden', 0.15)).toEqual({
      valueCategory: 'burden',
      confidence: 0.15,
    })
  })

  it("suppresses 'leak' defaults to { unsure, 0.1 }", () => {
    expect(gateDefaultEmission('leak', 0.6)).toEqual({
      valueCategory: 'unsure',
      confidence: SUPPRESSED_DEFAULT_CONFIDENCE,
    })
  })

  it("suppresses retired 'no_idea' defaults to { unsure, 0.1 }", () => {
    expect(gateDefaultEmission('no_idea', 0.15)).toEqual({
      valueCategory: 'unsure',
      confidence: SUPPRESSED_DEFAULT_CONFIDENCE,
    })
  })
})

describe('CARD_CONF_TO_RULE_CONF (VM-3)', () => {
  it('every explicit answer clears the display gate AND the application floor', () => {
    // Design-locked property: conviction modulates how easily later signals
    // override, never visibility.
    for (const conviction of [1, 2, 3, 4, 5] as const) {
      const conf = CARD_CONF_TO_RULE_CONF[conviction]
      expect(conf).toBeGreaterThanOrEqual(VALUE_DISPLAY_CONFIDENCE_THRESHOLD)
      expect(conf).toBeGreaterThanOrEqual(RULE_APPLICATION_MIN_CONFIDENCE)
      expect(conf).toBeLessThanOrEqual(1)
    }
  })

  it('is strictly monotonic in conviction', () => {
    expect(CARD_CONF_TO_RULE_CONF[1]).toBeLessThan(CARD_CONF_TO_RULE_CONF[2])
    expect(CARD_CONF_TO_RULE_CONF[2]).toBeLessThan(CARD_CONF_TO_RULE_CONF[3])
    expect(CARD_CONF_TO_RULE_CONF[3]).toBeLessThan(CARD_CONF_TO_RULE_CONF[4])
    expect(CARD_CONF_TO_RULE_CONF[4]).toBeLessThan(CARD_CONF_TO_RULE_CONF[5])
  })
})

describe('cardConvictionToRuleConfidence (VM-3)', () => {
  it('maps in-range convictions through the table', () => {
    expect(cardConvictionToRuleConfidence(1)).toBe(CARD_CONF_TO_RULE_CONF[1])
    expect(cardConvictionToRuleConfidence(3)).toBe(CARD_CONF_TO_RULE_CONF[3])
    expect(cardConvictionToRuleConfidence(5)).toBe(CARD_CONF_TO_RULE_CONF[5])
  })

  it('clamps out-of-range values (telemetry 0, overshoot, fractions)', () => {
    expect(cardConvictionToRuleConfidence(0)).toBe(CARD_CONF_TO_RULE_CONF[1])
    expect(cardConvictionToRuleConfidence(-3)).toBe(CARD_CONF_TO_RULE_CONF[1])
    expect(cardConvictionToRuleConfidence(9)).toBe(CARD_CONF_TO_RULE_CONF[5])
    expect(cardConvictionToRuleConfidence(2.6)).toBe(CARD_CONF_TO_RULE_CONF[3])
  })
})
