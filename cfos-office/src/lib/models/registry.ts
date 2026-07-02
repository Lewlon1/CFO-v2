import type { DecisionConfig, SlotDefinition } from './types'

const SLOTS: SlotDefinition[] = [
  { id: 'property_value', label: 'Current market value', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'purchase_price', label: 'Original purchase price', unit: '£', required: true, group: 'Property', tier: 'run' },
  { id: 'mortgage_balance', label: 'Outstanding mortgage', unit: '£', required: true, group: 'Property', tier: 'run' },
  {
    id: 'mortgage_rate_pct',
    label: 'Mortgage rate',
    unit: '%',
    required: false,
    group: 'Property',
    tier: 'run',
    relevantIf: (v) => (v.mortgage_balance ?? 0) > 0,
  },
  { id: 'ownership_share_pct', label: 'Your ownership share', unit: '%', required: true, group: 'Ownership', tier: 'run' },
  {
    id: 'will_never_let_flag',
    label: 'Would never rent it out',
    unit: 'bool',
    required: false,
    group: 'Letting',
    tier: 'run',
  },
  {
    id: 'monthly_rent',
    label: 'Achievable monthly rent',
    unit: '£/mo',
    required: true,
    group: 'Letting',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  {
    id: 'monthly_costs',
    label: 'Service charge + insurance',
    unit: '£/mo',
    required: true,
    group: 'Letting',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  {
    id: 'agent_fee_pct',
    label: 'Letting agent fee',
    unit: '%',
    required: false,
    group: 'Letting',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  {
    id: 'void_weeks',
    label: 'Void period',
    unit: 'wk/yr',
    required: false,
    group: 'Letting',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  { id: 'maintenance_pct', label: 'Maintenance', unit: '%/yr', required: false, group: 'Letting', tier: 'run' },
  {
    id: 'rental_tax_pct',
    label: 'Eff. tax on rental profit',
    unit: '%',
    required: false,
    group: 'Tax (simplified)',
    tier: 'run',
    relevantIf: (v) => (v.will_never_let_flag ?? 0) !== 1,
  },
  { id: 'cgt_rate_pct', label: 'Eff. CGT rate on sale', unit: '%', required: false, group: 'Tax (simplified)', tier: 'run' },
  { id: 'selling_costs_pct', label: 'Selling costs', unit: '%', required: false, group: 'Exit', tier: 'run' },
  { id: 'appreciation_pct', label: 'House price growth', unit: '%/yr', required: false, group: 'Market', tier: 'run' },
  { id: 'investment_return_pct', label: 'Index fund return', unit: '%/yr', required: false, group: 'Market', tier: 'run' },
  { id: 'cash_rate_pct', label: 'Cash savings rate', unit: '%/yr', required: false, group: 'Market', tier: 'run' },
  {
    id: 'horizon_years',
    label: 'Decision horizon',
    unit: 'yrs',
    required: true,
    group: 'Horizon',
    tier: 'profile',
    profileField: 'default_horizon_years',
  },
  // Scenario 4 — sell & redeploy into a new home. Inactive (defaults injected,
  // hidden from the ledger, skipped by the interviewer) until the user answers
  // yes to the branching question in the interview.
  {
    id: 'new_property_price',
    label: 'New property price',
    unit: '£',
    required: false,
    group: 'Redeploy',
    tier: 'run',
  },
  {
    id: 'new_buying_costs_pct',
    label: 'Buying costs (new home)',
    unit: '%',
    required: false,
    group: 'Redeploy',
    tier: 'run',
    relevantIf: (v) => (v.new_property_price ?? 0) > 0,
  },
  {
    id: 'new_mortgage_rate_pct',
    label: 'Mortgage rate (new home)',
    unit: '%',
    required: false,
    group: 'Redeploy',
    tier: 'run',
    relevantIf: (v) => (v.new_property_price ?? 0) > 0,
  },
  {
    id: 'new_property_appreciation_pct',
    label: 'House price growth (new home)',
    unit: '%/yr',
    required: false,
    group: 'Redeploy',
    tier: 'run',
    relevantIf: (v) => (v.new_property_price ?? 0) > 0,
  },
  {
    id: 'current_rent_paid_monthly',
    label: 'Rent you currently pay',
    unit: '£/mo',
    required: false,
    group: 'Redeploy',
    tier: 'run',
    relevantIf: (v) => (v.new_property_price ?? 0) > 0,
  },
]

const INTERVIEW_ORDER = [
  'property_value',
  'purchase_price',
  'mortgage_balance',
  'ownership_share_pct',
  'monthly_rent',
  'monthly_costs',
  'horizon_years',
]

export const PROPERTY_DECISION: DecisionConfig = {
  id: 'property',
  schemaVersion: 1,
  defaultsVersion: '2026-Q2-illustrative',
  slots: SLOTS,
  interview: [
    ...INTERVIEW_ORDER.map((id) => ({
      id,
      targetSlots: [id],
      prompt: SLOTS.find((s) => s.id === id)?.label ?? id,
    })),
    {
      id: 'redeploy_branch',
      targetSlots: ['new_property_price', 'current_rent_paid_monthly'],
      prompt: 'Would selling fund another property purchase?',
    },
  ],
  scenarios: ['rent', 'invest', 'cash', 'redeploy'],
}

export function activeSlots(values: Record<string, number | null>): SlotDefinition[] {
  return SLOTS.filter((s) => !s.relevantIf || s.relevantIf(values))
}

export { SLOTS as PROPERTY_SLOTS }
