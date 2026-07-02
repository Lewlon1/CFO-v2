import { describe, it, expect } from 'vitest'
import { resolveValues, saleNet, runModel, flipPoint } from './property'
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

// Canonical fixture — pinned against the M1 brief. Hand-verified: myProceeds0
// = 236400 * 0.3333 = 78,792.12; cgtToday share = 21600 * 0.3333 = 7,199.28;
// year-1 net rent CF share = (grossRent 22,615.3846 - agent 2,713.8462 -
// maint 4,800 - own 3,000 - interest 9,450 = profit 2,651.5385, tax 583.3385)
// * 0.3333 = 689.33. All match the brief's pinned expected values exactly.
const FIXTURE = {
  property_value: 480000,
  purchase_price: 390000,
  mortgage_balance: 210000,
  ownership_share_pct: 33.33,
  monthly_rent: 2000,
  monthly_costs: 250,
  horizon_years: 10,
  appreciation_pct: 3.0,
  investment_return_pct: 7.0,
  cash_rate_pct: 3.5,
  mortgage_rate_pct: 4.5,
  agent_fee_pct: 12,
  void_weeks: 3,
  selling_costs_pct: 2.5,
  maintenance_pct: 1.0,
  rental_tax_pct: 22,
  cgt_rate_pct: 24,
}

describe('runModel — golden fixture', () => {
  it('matches the brief-pinned sale-today, year-1 cash flow, and 10-year terminals', () => {
    const m = runModel(FIXTURE)
    expect(Math.round(m.myProceeds0)).toBe(78792)
    expect(Math.round(m.cgtToday)).toBe(7199)
    expect(Math.round(m.firstYearCF as number)).toBe(689)
    expect(Math.round(m.terminals.rent)).toBe(133621)
    expect(Math.round(m.terminals.invest)).toBe(154996)
    expect(Math.round(m.terminals.cash)).toBe(111144)
  })

  it('produces 11 rows (year 0 through horizon) and a monotonically increasing invest trajectory', () => {
    const m = runModel(FIXTURE)
    expect(m.rows).toHaveLength(11)
    for (let i = 1; i < m.rows.length; i++) {
      expect(m.rows[i].invest).toBeGreaterThan(m.rows[i - 1].invest)
    }
  })
})

describe('flipPoint', () => {
  it('finds the appreciation_pct crossover between rent-out and sell-and-invest', () => {
    const result = flipPoint(FIXTURE, 'appreciation_pct', -2, 12)
    expect(result).not.toBeNull()
    expect(result as number).toBeCloseTo(4.157, 2)

    const m = runModel({ ...FIXTURE, appreciation_pct: result as number })
    expect(Math.abs(m.terminals.rent - m.terminals.invest)).toBeLessThan(1)
  })

  it('returns null when there is no crossing in the given range', () => {
    const result = flipPoint(FIXTURE, 'appreciation_pct', 20, 30)
    expect(result).toBeNull()
  })
})

describe('runModel — edge cases', () => {
  it('zero mortgage: no interest deduction, no mortgage subtracted from sale proceeds', () => {
    const m = runModel({ ...FIXTURE, mortgage_balance: 0 })
    // net = 480000 - 12000(costs) - 0(mortgage) - 21600(cgt) = 446400; *0.3333 share = 148,785.12
    expect(Math.round(m.myProceeds0)).toBe(148785)
    expect(m.myProceeds0).toBeGreaterThan(runModel(FIXTURE).myProceeds0)
  })

  it('negative rental profit floors tax at zero, not a negative rebate', () => {
    const m = runModel({ ...FIXTURE, monthly_costs: 5000 })
    expect(m.firstYearCF).toBeLessThan(0)
    // If tax were allowed to go negative, netCF would differ from profit*share exactly.
    const grossRent = 2000 * 12 * (1 - 3 / 52)
    const agent = (grossRent * 12) / 100
    const maint = 480000 * 0.01
    const interest = (210000 * 4.5) / 100
    const own = 5000 * 12
    const profit = grossRent - agent - maint - own - interest
    expect(m.firstYearCF).toBeCloseTo(profit * 0.3333, 1)
  })

  it('100% ownership share returns the full sale net, unshared', () => {
    const m = runModel({ ...FIXTURE, ownership_share_pct: 100 })
    expect(m.myProceeds0).toBeCloseTo(236400, 6)
  })

  it('horizon of 1 year returns exactly 2 rows (year 0 and year 1)', () => {
    const m = runModel({ ...FIXTURE, horizon_years: 1 })
    expect(m.rows).toHaveLength(2)
    expect(m.terminals.rent).toBeCloseTo(83009.1, 0)
  })
})

describe('runModel — scenario 4 (sell & redeploy into a new home)', () => {
  // Hand-checked year 1: buyingCosts = 320000*0.11 = 35,200; totalCashNeeded =
  // 355,200; deposit (myProceeds0) = 78,792.12; newMortgage = 355,200 -
  // 78,792.12 = 276,407.88; pot0 = 0 (deposit < totalCashNeeded).
  // Year 1: avoidedRent = 1100*12 = 13,200; interest = 276,407.88*0.035 =
  // 9,674.28; maint = 320000*0.01 = 3,200; netBenefit = 13200 - 9674.28 -
  // 3200 = 325.72; pot1 = 325.72. newPrice1 = 320000*1.03 = 329,600;
  // sellingCosts1 = 329600*0.025 = 8,240; equity1 = 329600 - 276407.88 -
  // 8240 = 44,952.12. Row 1 = equity1 + pot1 = 45,277.84 -> rounds to 45,278,
  // matching the value below (computed by running the implementation and
  // confirmed against this hand check).
  //
  // runModel takes fully-resolved values (no implicit MARKET_DEFAULTS
  // fallback — that merge happens in resolveValues() upstream of this call),
  // so the three new_* redeploy rates the hand-check above depends on
  // (11 / 3.5 / 3.0, matching MARKET_DEFAULTS) must be stated explicitly here.
  const withRedeploy = {
    ...FIXTURE,
    new_property_price: 320000,
    current_rent_paid_monthly: 1100,
    new_buying_costs_pct: 11,
    new_mortgage_rate_pct: 3.5,
    new_property_appreciation_pct: 3.0,
  }

  it('matches the hand-checked year-1 redeploy trajectory point and pinned 10-year terminal', () => {
    const m = runModel(withRedeploy)
    expect(Math.round(m.rows[1].redeploy as number)).toBe(45278)
    expect(Math.round(m.terminals.redeploy as number)).toBe(141579)
  })

  it('appears as a ranked option alongside rent/invest/cash', () => {
    const m = runModel(withRedeploy)
    const ranked = Object.entries(m.terminals)
      .filter(([, val]) => val !== null)
      .sort(([, a], [, b]) => (b as number) - (a as number))
    expect(ranked.map(([k]) => k)).toContain('redeploy')
  })

  it('is null when the user has not opted into scenario 4 (no new_property_price)', () => {
    const m = runModel(FIXTURE)
    expect(m.terminals.redeploy).toBeNull()
    expect(m.rows[1].redeploy).toBeNull()
  })
})
