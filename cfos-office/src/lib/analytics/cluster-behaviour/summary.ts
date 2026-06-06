import type { ClusterBehaviour } from './types';

// Compose a one-line natural-language hint from the derived features.
// This is a HINT for the CFO — it works from the structured features directly
// for any specific call. The summary helps when surveying multiple clusters
// at once.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function symbolFor(currency: string): string {
  return currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : `${currency} `;
}

// Spend magnitude, currency-aware. Always positive: spend is stored negative in
// this codebase, but the summary describes a spend amount ("mean €24.61"), so a
// leading "-" reads as a credit. Mirrors deriveTrend, which also works in
// magnitude. Currency comes from the caller (the user's primary_currency) — the
// glyph used to be hardcoded to £, wrong for every non-GBP user.
function formatAmount(n: number, currency: string): string {
  const symbol = symbolFor(currency);
  const abs = Math.abs(n);
  if (abs >= 1000) return `${symbol}${(abs / 1000).toFixed(1)}k`;
  return `${symbol}${abs.toFixed(2)}`;
}

export function composeSummary(
  behaviour: Omit<ClusterBehaviour, 'summary'>,
  currency: string = 'EUR',
): string {
  const parts: string[] = [behaviour.cluster_id];
  const fragments: string[] = [];

  // Lifecycle takes precedence — dormant or new is the headline
  if (behaviour.lifecycle.status === 'dormant') {
    fragments.push(`dormant ${behaviour.lifecycle.days_since_last} days, last ${formatAmount(behaviour.amount_profile.mean_amount, currency)}`);
    return `${parts.join(': ')} ${fragments.join(', ')}`.trim();
  }
  if (behaviour.lifecycle.status === 'new' && behaviour.lifecycle.appeared_within_window) {
    const firstSeen = new Date(behaviour.lifecycle.first_seen);
    const monthName = firstSeen.toLocaleString('en-GB', { month: 'long' });
    fragments.push(`new in ${monthName}`);
  }

  // Recurrence
  if (behaviour.recurrence.pattern_label === 'daily') {
    fragments.push('clockwork daily habit');
  } else if (behaviour.recurrence.pattern_label === 'weekly') {
    fragments.push('weekly cadence');
  } else if (behaviour.recurrence.pattern_label === 'monthly') {
    fragments.push('monthly recurrence');
  } else if (behaviour.recurrence.pattern_label !== 'sparse') {
    fragments.push(`${behaviour.recurrence.pattern_label} pattern`);
  }

  // Time pattern
  if (behaviour.time_pattern.has_weekday_skew && behaviour.time_pattern.weekday_share > 0.85) {
    fragments.push('weekday-skewed');
  } else if (behaviour.time_pattern.has_weekday_skew && behaviour.time_pattern.weekday_share < 0.15) {
    fragments.push('weekend-skewed');
  } else if (behaviour.time_pattern.dominant_day !== null && behaviour.time_pattern.day_of_week_distribution[behaviour.time_pattern.dominant_day] >= 0.4) {
    fragments.push(`mostly ${DAY_NAMES[behaviour.time_pattern.dominant_day]}`);
  }

  // Amount
  if (behaviour.amount_profile.mean_amount !== 0) {
    fragments.push(`mean ${formatAmount(behaviour.amount_profile.mean_amount, currency)}`);
  }

  // Trend
  if (behaviour.trend.direction === 'climbing' && behaviour.trend.slope_percent_per_month !== null) {
    fragments.push(`climbing +${behaviour.trend.slope_percent_per_month.toFixed(0)}%/mo`);
  } else if (behaviour.trend.direction === 'declining' && behaviour.trend.slope_percent_per_month !== null) {
    fragments.push(`declining ${behaviour.trend.slope_percent_per_month.toFixed(0)}%/mo`);
  } else if (behaviour.trend.direction === 'volatile') {
    fragments.push('volatile');
  } else if (behaviour.trend.direction === 'stable') {
    fragments.push('flat trend');
  }

  return `${parts.join(': ')} ${fragments.join(', ')}`.trim();
}
