import type { MarketDefault } from './types'

export const DEFAULTS_VERSION = '2026-Q2-illustrative'

export const MARKET_DEFAULTS: Record<string, MarketDefault> = {
  appreciation_pct: { value: 3.0, source: 'UK long-run nominal house price growth', asOf: '2026-05' },
  investment_return_pct: { value: 7.0, source: 'Global equity long-run nominal return', asOf: '2026-05' },
  cash_rate_pct: { value: 3.5, source: 'Easy-access GBP savings, typical', asOf: '2026-05' },
  mortgage_rate_pct: { value: 4.5, source: 'UK BTL remortgage, typical', asOf: '2026-05' },
  agent_fee_pct: { value: 12, source: 'London full management, 10-15% range', asOf: '2026-04' },
  void_weeks: { value: 3, source: 'London average void period, wks/yr', asOf: '2026-04' },
  selling_costs_pct: { value: 2.5, source: 'Agent + legal + EPC, typical London', asOf: '2026-04' },
  maintenance_pct: { value: 1.0, source: 'Rule of thumb, % of value p.a.', asOf: 'static' },
  rental_tax_pct: { value: 22, source: 'SIMPLIFIED blend: UK NRL + ES top-up', asOf: 'simplified' },
  cgt_rate_pct: { value: 24, source: 'SIMPLIFIED: UK res. CGT, no rebasing', asOf: 'simplified' },
  new_buying_costs_pct: { value: 11, source: 'SIMPLIFIED: ES ITP + notary', asOf: 'simplified' },
  new_mortgage_rate_pct: { value: 3.5, source: 'ES residential mortgage, typical', asOf: '2026-05' },
  new_property_appreciation_pct: { value: 3.0, source: 'ES long-run nominal house price growth', asOf: '2026-05' },
}
