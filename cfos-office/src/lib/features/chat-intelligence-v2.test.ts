import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isChatIntelligenceV2Enabled } from './chat-intelligence-v2'

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

  it('returns true for beta_cohort=wave_1', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_1' })).toBe(true)
  })

  it('returns true for beta_cohort=wave_1_5', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_1_5' })).toBe(true)
  })

  it('returns false for beta_cohort=wave_2', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_2' })).toBe(false)
  })

  it('returns false for beta_cohort=wave_3', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_3' })).toBe(false)
  })

  it('returns false for beta_cohort=public', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'public' })).toBe(false)
  })

  it('returns false for null beta_cohort', () => {
    expect(isChatIntelligenceV2Enabled({ beta_cohort: null })).toBe(false)
  })

  it('returns false for null profile', () => {
    expect(isChatIntelligenceV2Enabled(null)).toBe(false)
  })

  it('returns false for undefined profile', () => {
    expect(isChatIntelligenceV2Enabled(undefined)).toBe(false)
  })

  it('env override returns true even when profile is null', () => {
    process.env.CHAT_INTELLIGENCE_V2_FORCE = '1'
    expect(isChatIntelligenceV2Enabled(null)).toBe(true)
  })

  it('env override returns true even for non-cohort users (public)', () => {
    process.env.CHAT_INTELLIGENCE_V2_FORCE = '1'
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'public' })).toBe(true)
  })

  it('env override returns true for wave_2 (would otherwise be false)', () => {
    process.env.CHAT_INTELLIGENCE_V2_FORCE = '1'
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'wave_2' })).toBe(true)
  })

  it('env override value other than "1" does NOT enable', () => {
    process.env.CHAT_INTELLIGENCE_V2_FORCE = 'true'
    expect(isChatIntelligenceV2Enabled({ beta_cohort: 'public' })).toBe(false)
  })
})
