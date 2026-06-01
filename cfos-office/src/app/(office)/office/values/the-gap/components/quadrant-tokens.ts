// Quadrant colour + label tokens for the three Gap card shapes and the Gap
// ValueMapSummary header. The colour values are CSS custom properties defined in
// globals.css (--gap-quadrant-*) — an intentionally distinct, more editorial palette
// than the value-category tokens (softer hues that read better against the office
// dark surfaces + italic serif), but sourced from globals.css like everything else
// (single colour source of truth — no inline hex). Consumed via inline `style`, so
// the var() references resolve in the DOM.

export type Quadrant = 'foundation' | 'investment' | 'leak' | 'burden' | 'unsure'

export const QUADRANT_COLOURS: Record<Quadrant, string> = {
  foundation: 'var(--gap-quadrant-foundation)',
  investment: 'var(--gap-quadrant-investment)',
  leak: 'var(--gap-quadrant-leak)',
  burden: 'var(--gap-quadrant-burden)',
  unsure: 'var(--gap-quadrant-unsure)',
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
