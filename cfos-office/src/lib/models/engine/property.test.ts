import { describe, it, expect } from 'vitest'
import { resolveValues, saleNet } from './property'
import { MARKET_DEFAULTS } from '../marketDefaults'
import type { SlotDefinition, SlotMap } from '../types'

const SLOTS: SlotDefinition[] = [
  { id: 'property_value', label: 'Current market value', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'purchase_price', label: 'Original purchase price', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'mortgage_balance', label: 'Outstanding mortgage', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'selling_costs_pct', label: 'Selling costs', unit: '%', required: false, group: 'Exit', tier: 'run' },
  { id: 'cgt_rate_pct', label: 'Eff. CGT rate on sale', unit: '%', required: false, group: 'Tax (simplified)', tier: 'run' },
]

describe('resolveValues', () => {
  it('prefers a stated run value over the market default', () => {
    const slots: SlotMap = { property_value: { value: 500000, origin: 'user' } }
    const resolved = resolveValues(slots, SLOTS, MARKET_DEFAULTS)
    expect(resolved.property_value).toBe(500000)
  })

  it('falls back to the market default when unset', () => {
    const resolved = resolveValues({}, SLOTS, MARKET_DEFAULTS)
    expect(resolved.selling_costs_pct).toBe(2.5)
    expect(resolved.cgt_rate_pct).toBe(24)
  })

  it('returns null for a required slot with no default and no stated value', () => {
    const resolved = resolveValues({}, SLOTS, MARKET_DEFAULTS)
    expect(resolved.property_value).toBeNull()
  })

  it('ignores a NaN-valued entry and falls through to default', () => {
    const slots: SlotMap = { cgt_rate_pct: { value: Number.NaN, origin: 'edited' } }
    const resolved = resolveValues(slots, SLOTS, MARKET_DEFAULTS)
    expect(resolved.cgt_rate_pct).toBe(24)
  })
})

describe('saleNet', () => {
  it('nets a property value against costs, mortgage, and CGT on the gain', () => {
    const result = saleNet(480000, 390000, 210000, { selling_costs_pct: 2.5, cgt_rate_pct: 24 })
    // costs = 480000*0.025 = 12000; gain = 90000; cgt = 90000*0.24 = 21600
    // net = 480000 - 12000 - 210000 - 21600 = 236400
    expect(result.costs).toBeCloseTo(12000, 6)
    expect(result.cgt).toBeCloseTo(21600, 6)
    expect(result.net).toBeCloseTo(236400, 6)
  })

  it('floors the taxable gain at zero when selling below purchase price', () => {
    const result = saleNet(300000, 390000, 210000, { selling_costs_pct: 2.5, cgt_rate_pct: 24 })
    expect(result.cgt).toBe(0)
  })
})
