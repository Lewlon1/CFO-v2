import type { MarketDefault, ModelResult, SlotDefinition, SlotMap } from '../types'

export function resolveValues(
  slots: SlotMap,
  slotDefs: SlotDefinition[],
  marketDefaults: Record<string, MarketDefault>
): Record<string, number | null> {
  const v: Record<string, number | null> = {}
  for (const s of slotDefs) {
    const entry = slots[s.id]
    if (entry && entry.value !== null && entry.value !== undefined && !Number.isNaN(entry.value)) {
      v[s.id] = Number(entry.value)
    } else if (marketDefaults[s.id]) {
      v[s.id] = marketDefaults[s.id].value
    } else {
      v[s.id] = null
    }
  }
  return v
}

export function saleNet(
  pv: number,
  purchasePrice: number,
  mortgage: number,
  v: { selling_costs_pct: number; cgt_rate_pct: number }
): { net: number; costs: number; cgt: number } {
  const costs = (pv * v.selling_costs_pct) / 100
  const gain = Math.max(0, pv - purchasePrice)
  const cgt = (gain * v.cgt_rate_pct) / 100
  return { net: pv - costs - mortgage - cgt, costs, cgt }
}

export function runModel(v: Record<string, number>): ModelResult {
  const share = v.ownership_share_pct / 100
  const years = Math.max(1, Math.round(v.horizon_years))

  const s0 = saleNet(v.property_value, v.purchase_price, v.mortgage_balance, {
    selling_costs_pct: v.selling_costs_pct,
    cgt_rate_pct: v.cgt_rate_pct,
  })
  const myProceeds0 = s0.net * share

  let invest = myProceeds0
  let cash = myProceeds0

  let pv = v.property_value
  let rentMo = v.monthly_rent
  let rentPot = 0
  let firstYearCF: number | null = null

  const rentRows: number[] = [s0.net * share]
  const investRows: number[] = [myProceeds0]
  const cashRows: number[] = [myProceeds0]

  for (let y = 1; y <= years; y++) {
    invest *= 1 + v.investment_return_pct / 100
    cash *= 1 + v.cash_rate_pct / 100

    const grossRent = rentMo * 12 * (1 - v.void_weeks / 52)
    const agent = (grossRent * v.agent_fee_pct) / 100
    const maint = (pv * v.maintenance_pct) / 100
    const interest = (v.mortgage_balance * v.mortgage_rate_pct) / 100
    const own = v.monthly_costs * 12
    const profit = grossRent - agent - maint - own - interest
    const tax = Math.max(0, profit) * (v.rental_tax_pct / 100)
    const netCF = (profit - tax) * share
    if (y === 1) firstYearCF = netCF

    rentPot = rentPot * (1 + v.cash_rate_pct / 100) + netCF
    pv *= 1 + v.appreciation_pct / 100
    rentMo *= 1 + v.appreciation_pct / 100

    const sy = saleNet(pv, v.purchase_price, v.mortgage_balance, {
      selling_costs_pct: v.selling_costs_pct,
      cgt_rate_pct: v.cgt_rate_pct,
    })
    rentRows.push(sy.net * share + rentPot)
    investRows.push(invest)
    cashRows.push(cash)
  }

  const redeployRows = runRedeploy(v, years, myProceeds0)

  const rows = rentRows.map((rent, i) => ({
    year: i,
    rent,
    invest: investRows[i],
    cash: cashRows[i],
    redeploy: redeployRows ? redeployRows[i] : null,
  }))

  return {
    rows,
    myProceeds0,
    cgtToday: s0.cgt * share,
    firstYearCF,
    terminals: {
      rent: rentRows[rentRows.length - 1],
      invest: investRows[investRows.length - 1],
      cash: cashRows[cashRows.length - 1],
      redeploy: redeployRows ? redeployRows[redeployRows.length - 1] : null,
    },
  }
}

// Scenario 4 — sell & redeploy proceeds as the deposit on a new owner-occupied
// home. Interest-only simplification, same as the London side. Returns null
// when the user hasn't opted into this scenario (no target property price).
function runRedeploy(v: Record<string, number>, years: number, deposit: number): number[] | null {
  const newPrice0 = v.new_property_price
  if (!newPrice0 || newPrice0 <= 0) return null

  const buyingCostsPct = v.new_buying_costs_pct
  const mortgageRate = v.new_mortgage_rate_pct
  const appreciation = v.new_property_appreciation_pct
  const rentPaid = v.current_rent_paid_monthly ?? 0

  const buyingCosts = (newPrice0 * buyingCostsPct) / 100
  const totalCashNeeded = newPrice0 + buyingCosts
  const newMortgage = Math.max(0, totalCashNeeded - deposit)
  let pot = Math.max(0, deposit - totalCashNeeded)
  let newPrice = newPrice0

  const rows = [newPrice0 - newMortgage + pot]
  for (let y = 1; y <= years; y++) {
    const avoidedRent = rentPaid * 12
    const interest = (newMortgage * mortgageRate) / 100
    const maint = (newPrice * v.maintenance_pct) / 100
    const netBenefit = avoidedRent - interest - maint
    pot = pot * (1 + v.cash_rate_pct / 100) + netBenefit
    newPrice *= 1 + appreciation / 100
    const sellingCosts = (newPrice * v.selling_costs_pct) / 100
    const equity = newPrice - newMortgage - sellingCosts
    rows.push(equity + pot)
  }
  return rows
}
