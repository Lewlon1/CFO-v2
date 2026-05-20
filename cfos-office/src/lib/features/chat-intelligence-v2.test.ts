import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isChatIntelligenceV2Enabled } from './chat-intelligence-v2'

// As of v2.5.1 the gate is default-on. Env var CHAT_INTELLIGENCE_V2_FORCE=0
// is the V1 escape hatch. beta_cohort is no longer consulted by this gate
// (the field is retained on the schema for other features).
describe('isChatIntelligenceV2Enabled', () => {
  const originalForce = process.env.CHAT_INTELLIGENCE_V2_FORCE

  beforeEach(() => {
    delete process.env.CHAT_INTELLIGENCE_V2_FORCE
  })

  afterEach(() => {
    if (originalForce === undefined) {
      delete process.env.CHAT_INTELLIGENCE_V2_FORCE
    } else {
      process.env.CHAT_INTELLIGENCE_V2_FORCE = originalForce
    }
  })

  it('returns true by default (V2 is default-on)', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'public' })).toBe(true)
  })

  it('returns true for any beta_cohort value (gate ignores cohort)', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_1' })).toBe(true)
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_1_5' })).toBe(true)
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_2' })).toBe(true)
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_3' })).toBe(true)
  })

  it('returns true for null beta_cohort', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: null })).toBe(true)
  })

  it('returns true for null profile', () => {
    expect(isChatIntelligenceV2Enabled(null)).toBe(true)
  })

  it('returns true for undefined profile', () => {
    expect(isChatIntelligenceV2Enabled(undefined)).toBe(true)
  })

  it('env override CHAT_INTELLIGENCE_V2_FORCE=0 falls back to V1', () => {
    process.env.CHAT_INTELLIGENCE_V2_FORCE = '0'
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'public' })).toBe(false)
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_1' })).toBe(false)
    expect(isChatIntelligenceV2Enabled(null)).toBe(false)
  })

  it('env override values other than "0" leave V2 default-on', () => {
    process.env.CHAT_INTELLIGENCE_V2_FORCE = 'true'
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'public' })).toBe(true)
    process.env.CHAT_INTELLIGENCE_V2_FORCE = '1'
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'public' })).toBe(true)
    process.env.CHAT_INTELLIGENCE_V2_FORCE = ''
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'public' })).toBe(true)
  })
})
