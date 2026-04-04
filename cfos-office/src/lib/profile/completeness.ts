const COMPLETENESS_FIELDS = [
  'country',
  'primary_currency',
  'age_range',
  'employment_status',
  'net_monthly_income',
  'housing_type',
  'relationship_status',
  'values_ranking',
  'risk_tolerance',
  'advice_style',
] as const

export function calculateCompleteness(profile: Record<string, unknown>): number {
  const filled = COMPLETENESS_FIELDS.filter(
    (f) => profile[f] !== null && profile[f] !== undefined && profile[f] !== ''
  ).length
  return Math.round((filled / COMPLETENESS_FIELDS.length) * 100)
}
