export type SlotOrigin = 'user' | 'edited' | 'market' | 'profile'

export interface SlotDefinition {
  id: string
  label: string
  unit: string
  required: boolean
  group: string
  tier: 'run' | 'profile'
  /** Only set for the one slot (horizon_years) that has a profile-tier fallback. */
  profileField?: 'default_horizon_years'
  relevantIf?: (values: Record<string, number | null>) => boolean
}

export interface SlotValue {
  value: number
  origin: SlotOrigin
}

export type SlotMap = Record<string, SlotValue | undefined>

export interface MarketDefault {
  value: number
  source: string
  asOf: string
}

export interface ResolvedValues {
  values: Record<string, number | null>
  provenance: Record<string, SlotOrigin | null>
}

export interface ModelRow {
  year: number
  rent: number
  invest: number
  cash: number
  redeploy: number | null
}

export interface ModelResult {
  rows: ModelRow[]
  myProceeds0: number
  cgtToday: number
  firstYearCF: number | null
  terminals: {
    rent: number
    invest: number
    cash: number
    redeploy: number | null
  }
}

export interface InterviewNode {
  id: string
  targetSlots: string[]
  prompt: string
}

export interface DecisionConfig {
  id: string
  schemaVersion: number
  defaultsVersion: string
  slots: SlotDefinition[]
  interview: InterviewNode[]
  scenarios: string[]
}
