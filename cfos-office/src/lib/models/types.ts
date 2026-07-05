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

export type ScenarioKey = 'rent' | 'invest' | 'cash' | 'redeploy'

/** The year in which the leading strategy changes, and which way. */
export interface LeaderChange {
  year: number
  from: ScenarioKey
  to: ScenarioKey
}

export interface SaleTodayBreakdown {
  propertyValue: number
  sellingCosts: number
  cgt: number
  mortgageBalance: number
  netTotal: number
  sharePct: number
  myProceeds: number
  myCgt: number
}

export interface RentYearOneBreakdown {
  grossRentFull: number
  voidLoss: number
  grossRent: number
  agentFee: number
  maintenance: number
  ownCosts: number
  mortgageInterest: number
  profitPreTax: number
  tax: number
  netTotal: number
  netShare: number
}

export interface RentBreakdown {
  yearOne: RentYearOneBreakdown
  appreciationPct: number
  cashRatePct: number
  propertyValueAtHorizon: number
  saleNetShareAtHorizon: number
  rentPotAtHorizon: number
  total: number
}

/** Shared shape for the two "sell then grow a lump sum" scenarios (invest, cash). */
export interface GrowthBreakdown {
  start: number
  ratePct: number
  years: number
  end: number
}

export interface RedeployBreakdown {
  deposit: number
  newPropertyPrice: number
  buyingCosts: number
  cashNeeded: number
  newMortgage: number
  leftoverPot: number
  yearOne: {
    avoidedRent: number
    interest: number
    maintenance: number
    netBenefit: number
  }
  appreciationPct: number
  newPriceAtHorizon: number
  equityAtHorizon: number
  /** Running savings pot at the horizon — can be negative (an accumulated shortfall). */
  potAtHorizon: number
  total: number
}

export interface ModelBreakdown {
  saleToday: SaleTodayBreakdown
  rent: RentBreakdown
  invest: GrowthBreakdown
  cash: GrowthBreakdown
  redeploy: RedeployBreakdown | null
}

export interface ModelResult {
  rows: ModelRow[]
  horizonYears: number
  myProceeds0: number
  cgtToday: number
  firstYearCF: number | null
  terminals: {
    rent: number
    invest: number
    cash: number
    redeploy: number | null
  }
  breakdown: ModelBreakdown
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
