import type { MarketDefault, ResolvedValues, SlotDefinition, SlotMap } from './types'

export function resolveRunValues(
  runAssumptions: SlotMap,
  profile: { default_horizon_years?: number | null } | null,
  slotDefs: SlotDefinition[],
  marketDefaults: Record<string, MarketDefault>
): ResolvedValues {
  const values: Record<string, number | null> = {}
  const provenance: Record<string, ResolvedValues['provenance'][string]> = {}

  for (const slot of slotDefs) {
    const runEntry = runAssumptions[slot.id]
    if (runEntry && typeof runEntry.value === 'number' && !Number.isNaN(runEntry.value)) {
      values[slot.id] = runEntry.value
      provenance[slot.id] = runEntry.origin
      continue
    }

    if (slot.tier === 'profile' && slot.profileField && profile) {
      const profileVal = profile[slot.profileField]
      if (typeof profileVal === 'number' && !Number.isNaN(profileVal)) {
        values[slot.id] = profileVal
        provenance[slot.id] = 'profile'
        continue
      }
    }

    const def = marketDefaults[slot.id]
    if (def) {
      values[slot.id] = def.value
      provenance[slot.id] = 'market'
      continue
    }

    values[slot.id] = null
    provenance[slot.id] = null
  }

  return { values, provenance }
}
