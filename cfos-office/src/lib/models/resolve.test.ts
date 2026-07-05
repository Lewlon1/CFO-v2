import { describe, it, expect } from 'vitest'
import { resolveRunValues } from './resolve'
import { PROPERTY_SLOTS } from './registry'
import { MARKET_DEFAULTS } from './marketDefaults'
import type { SlotMap } from './types'

describe('resolveRunValues — precedence run > profile > market', () => {
  it('prefers a run-level stated value over profile and market', () => {
    const runAssumptions: SlotMap = { horizon_years: { value: 15, origin: 'user' } }
    const profile = { default_horizon_years: 10 }
    const result = resolveRunValues(runAssumptions, profile, PROPERTY_SLOTS, MARKET_DEFAULTS)
    expect(result.values.horizon_years).toBe(15)
    expect(result.provenance.horizon_years).toBe('user')
  })

  it('falls back to the profile value when no run value is stated', () => {
    const result = resolveRunValues({}, { default_horizon_years: 12 }, PROPERTY_SLOTS, MARKET_DEFAULTS)
    expect(result.values.horizon_years).toBe(12)
    expect(result.provenance.horizon_years).toBe('profile')
  })

  it('falls back to the market default when neither run nor profile has a value', () => {
    const result = resolveRunValues({}, null, PROPERTY_SLOTS, MARKET_DEFAULTS)
    expect(result.values.appreciation_pct).toBe(3.0)
    expect(result.provenance.appreciation_pct).toBe('market')
    // horizon_years has no market default and no profile — null.
    expect(result.values.horizon_years).toBeNull()
    expect(result.provenance.horizon_years).toBeNull()
  })

  it('a required run-only slot with no default and no run value resolves to null', () => {
    const result = resolveRunValues({}, null, PROPERTY_SLOTS, MARKET_DEFAULTS)
    expect(result.values.property_value).toBeNull()
    expect(result.provenance.property_value).toBeNull()
  })
})
