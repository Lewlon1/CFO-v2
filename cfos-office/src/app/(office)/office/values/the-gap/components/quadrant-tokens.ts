// Quadrant colour + label tokens used across the three V2 Gap card shapes
// and the ValueMapSummary header. These intentionally diverge from
// `valueCategories` in @/lib/tokens — the Gap prototype uses softer, more
// editorial hues that read better against the office dark surfaces and
// against the italic serif type. Keeping them local to the Gap page keeps
// the broader design system stable.

export type Quadrant = 'foundation' | 'investment' | 'leak' | 'burden' | 'unsure'

export const QUADRANT_COLOURS: Record<Quadrant, string> = {
  foundation: '#7A9E7E',
  investment: '#D4A24C',
  leak: '#B8584F',
  burden: '#8A7468',
  unsure: '#605749',
}

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  foundation: 'Foundation',
  investment: 'Investment',
  leak: 'Leak',
  burden: 'Burden',
  unsure: 'Unsure',
}

// Time-context bucket labels (from /lib/utils/time-context.ts) used by
// MultiIntentGapCard slice rows. The DB key strings come direct from
// getTimeContext().
export const TIME_BUCKET_LABELS: Record<string, string> = {
  weekday_early: 'Weekday early',
  weekday_midday: 'Weekday midday',
  weekday_evening: 'Weekday evening',
  weekday_late: 'Weekday late',
  weekend_morning: 'Weekend morning',
  weekend_afternoon: 'Weekend afternoon',
  weekend_evening: 'Weekend evening',
}

export function formatTimeBucketLabel(bucket: string): string {
  return TIME_BUCKET_LABELS[bucket] ?? bucket
}
