import type {
  LeaderChange,
  MarketDefault,
  ModelResult,
  ModelRow,
  RedeployBreakdown,
  RentYearOneBreakdown,
  ScenarioKey,
  SlotDefinition,
  SlotMap,
} from '../types'

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

export function runModel(v: Record<string, number>, computeYears?: number): ModelResult {
  const share = v.ownership_share_pct / 100
  const years = Math.max(1, Math.round(v.horizon_years))
  // The trajectory can be computed past the stated horizon (for the timelines
  // table) without moving the verdict: terminals/firstYearCF stay indexed at
  // `years`. flipPoint calls pass no computeYears, so its behaviour is unchanged.
  const totalYears = Math.max(years, Math.round(computeYears ?? 0))

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
  let yearOne: RentYearOneBreakdown | null = null
  // Rent-scenario snapshot at the stated horizon, captured inside the loop.
  let rentHorizon = { propertyValue: pv, saleNetShare: s0.net * share, rentPot: 0, total: s0.net * share }

  const rentRows: number[] = [s0.net * share]
  const investRows: number[] = [myProceeds0]
  const cashRows: number[] = [myProceeds0]

  for (let y = 1; y <= totalYears; y++) {
    invest *= 1 + v.investment_return_pct / 100
    cash *= 1 + v.cash_rate_pct / 100

    const grossRentFull = rentMo * 12
    const grossRent = grossRentFull * (1 - v.void_weeks / 52)
    const agent = (grossRent * v.agent_fee_pct) / 100
    const maint = (pv * v.maintenance_pct) / 100
    const interest = (v.mortgage_balance * v.mortgage_rate_pct) / 100
    const own = v.monthly_costs * 12
    const profit = grossRent - agent - maint - own - interest
    const tax = Math.max(0, profit) * (v.rental_tax_pct / 100)
    const netCF = (profit - tax) * share
    if (y === 1) {
      firstYearCF = netCF
      yearOne = {
        grossRentFull,
        voidLoss: grossRentFull - grossRent,
        grossRent,
        agentFee: agent,
        maintenance: maint,
        ownCosts: own,
        mortgageInterest: interest,
        profitPreTax: profit,
        tax,
        netTotal: profit - tax,
        netShare: netCF,
      }
    }

    rentPot = rentPot * (1 + v.cash_rate_pct / 100) + netCF
    pv *= 1 + v.appreciation_pct / 100
    rentMo *= 1 + v.appreciation_pct / 100

    const sy = saleNet(pv, v.purchase_price, v.mortgage_balance, {
      selling_costs_pct: v.selling_costs_pct,
      cgt_rate_pct: v.cgt_rate_pct,
    })
    const rentTotal = sy.net * share + rentPot
    if (y === years) {
      rentHorizon = { propertyValue: pv, saleNetShare: sy.net * share, rentPot, total: rentTotal }
    }
    rentRows.push(rentTotal)
    investRows.push(invest)
    cashRows.push(cash)
  }

  const redeploy = runRedeploy(v, totalYears, years, myProceeds0)
  const redeployRows = redeploy?.rows ?? null

  const rows: ModelRow[] = rentRows.map((rent, i) => ({
    year: i,
    rent,
    invest: investRows[i],
    cash: cashRows[i],
    redeploy: redeployRows ? redeployRows[i] : null,
  }))

  const terminals = {
    rent: rentRows[years],
    invest: investRows[years],
    cash: cashRows[years],
    redeploy: redeployRows ? redeployRows[years] : null,
  }

  return {
    rows,
    horizonYears: years,
    myProceeds0,
    cgtToday: s0.cgt * share,
    firstYearCF,
    terminals,
    breakdown: {
      saleToday: {
        propertyValue: v.property_value,
        sellingCosts: s0.costs,
        cgt: s0.cgt,
        mortgageBalance: v.mortgage_balance,
        netTotal: s0.net,
        sharePct: v.ownership_share_pct,
        myProceeds: myProceeds0,
        myCgt: s0.cgt * share,
      },
      rent: {
        // yearOne is always assigned (loop runs at least once) — fall back defensively.
        yearOne: yearOne as RentYearOneBreakdown,
        appreciationPct: v.appreciation_pct,
        cashRatePct: v.cash_rate_pct,
        propertyValueAtHorizon: rentHorizon.propertyValue,
        saleNetShareAtHorizon: rentHorizon.saleNetShare,
        rentPotAtHorizon: rentHorizon.rentPot,
        total: rentHorizon.total,
      },
      invest: { start: myProceeds0, ratePct: v.investment_return_pct, years, end: terminals.invest },
      cash: { start: myProceeds0, ratePct: v.cash_rate_pct, years, end: terminals.cash },
      redeploy: redeploy?.breakdown ?? null,
    },
  }
}

// Scenario 4 — sell & redeploy proceeds as the deposit on a new owner-occupied
// home. Interest-only simplification, same as the London side. Returns null
// when the user hasn't opted into this scenario (no target property price).
function runRedeploy(
  v: Record<string, number>,
  totalYears: number,
  statedYears: number,
  deposit: number
): { rows: number[]; breakdown: RedeployBreakdown } | null {
  const newPrice0 = v.new_property_price
  if (!newPrice0 || newPrice0 <= 0) return null

  const buyingCostsPct = v.new_buying_costs_pct
  const mortgageRate = v.new_mortgage_rate_pct
  const appreciation = v.new_property_appreciation_pct
  const rentPaid = v.current_rent_paid_monthly ?? 0

  const buyingCosts = (newPrice0 * buyingCostsPct) / 100
  const totalCashNeeded = newPrice0 + buyingCosts
  const newMortgage = Math.max(0, totalCashNeeded - deposit)
  const leftoverPot = Math.max(0, deposit - totalCashNeeded)
  let pot = leftoverPot
  let newPrice = newPrice0

  let yearOne = { avoidedRent: 0, interest: 0, maintenance: 0, netBenefit: 0 }
  let horizon = {
    newPriceAtHorizon: newPrice0,
    equityAtHorizon: newPrice0 - newMortgage,
    potAtHorizon: leftoverPot,
    total: newPrice0 - newMortgage + leftoverPot,
  }

  const rows = [newPrice0 - newMortgage + leftoverPot]
  for (let y = 1; y <= totalYears; y++) {
    const avoidedRent = rentPaid * 12
    const interest = (newMortgage * mortgageRate) / 100
    const maint = (newPrice * v.maintenance_pct) / 100
    const netBenefit = avoidedRent - interest - maint
    if (y === 1) yearOne = { avoidedRent, interest, maintenance: maint, netBenefit }
    pot = pot * (1 + v.cash_rate_pct / 100) + netBenefit
    newPrice *= 1 + appreciation / 100
    const sellingCosts = (newPrice * v.selling_costs_pct) / 100
    const equity = newPrice - newMortgage - sellingCosts
    const total = equity + pot
    if (y === statedYears) {
      horizon = { newPriceAtHorizon: newPrice, equityAtHorizon: equity, potAtHorizon: pot, total }
    }
    rows.push(total)
  }

  return {
    rows,
    breakdown: {
      deposit,
      newPropertyPrice: newPrice0,
      buyingCosts,
      cashNeeded: totalCashNeeded,
      newMortgage,
      leftoverPot,
      yearOne,
      appreciationPct: appreciation,
      newPriceAtHorizon: horizon.newPriceAtHorizon,
      equityAtHorizon: horizon.equityAtHorizon,
      potAtHorizon: horizon.potAtHorizon,
      total: horizon.total,
    },
  }
}

// Which strategy leads shifts as the horizon lengthens. Walk the per-year rows
// and emit a change whenever the argmax (over non-null scenarios) differs from
// the prior year. Strict `>` so an exact tie never registers as a flip.
export function leaderChanges(rows: ModelRow[]): LeaderChange[] {
  const keys: ScenarioKey[] = ['rent', 'invest', 'cash', 'redeploy']
  const leaderAt = (row: ModelRow): ScenarioKey | null => {
    let best: ScenarioKey | null = null
    let bestVal = -Infinity
    for (const k of keys) {
      const val = row[k]
      if (val === null || val === undefined) continue
      if (val > bestVal) {
        bestVal = val
        best = k
      }
    }
    return best
  }

  const changes: LeaderChange[] = []
  let prev = rows.length > 1 ? leaderAt(rows[1]) : null
  for (let y = 2; y < rows.length; y++) {
    const cur = leaderAt(rows[y])
    if (cur && prev && cur !== prev) {
      changes.push({ year: y, from: prev, to: cur })
    }
    if (cur) prev = cur
  }
  return changes
}

export function flipPoint(
  v: Record<string, number>,
  varId: string,
  lo: number,
  hi: number
): number | null {
  const gap = (x: number) => {
    const m = runModel({ ...v, [varId]: x })
    return m.terminals.rent - m.terminals.invest
  }
  let a = lo
  let b = hi
  let fa = gap(a)
  let fb = gap(b)
  if (fa * fb > 0) return null
  for (let i = 0; i < 60; i++) {
    const mid = (a + b) / 2
    const fm = gap(mid)
    if (fa * fm <= 0) {
      b = mid
      fb = fm
    } else {
      a = mid
      fa = fm
    }
  }
  return (a + b) / 2
}
