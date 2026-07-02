import type { MarketDefault, SlotDefinition, SlotMap } from '../types'

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
