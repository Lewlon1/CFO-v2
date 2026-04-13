/**
 * Maps a timestamp to one of 7 time-context buckets.
 * Used by correction_signals to tag when a transaction occurred.
 */

export type TimeContext =
  | 'weekday_early'      // Mon-Fri 05:00-08:59
  | 'weekday_midday'     // Mon-Fri 09:00-13:59
  | 'weekday_evening'    // Mon-Fri 14:00-20:59
  | 'weekday_late'       // Mon-Fri 21:00-04:59
  | 'weekend_morning'    // Sat-Sun 05:00-11:59
  | 'weekend_afternoon'  // Sat-Sun 12:00-17:59
  | 'weekend_evening'    // Sat-Sun 18:00-04:59

export function getTimeContext(timestamp: Date): TimeContext {
  const hour = timestamp.getHours()
  const day = timestamp.getDay() // 0=Sun, 6=Sat
  const isWeekend = day === 0 || day === 6

  if (isWeekend) {
    if (hour >= 5 && hour < 12) return 'weekend_morning'
    if (hour >= 12 && hour < 18) return 'weekend_afternoon'
    return 'weekend_evening' // 18-04
  }

  // Weekday
  if (hour >= 5 && hour < 9) return 'weekday_early'
  if (hour >= 9 && hour < 14) return 'weekday_midday'
  if (hour >= 14 && hour < 21) return 'weekday_evening'
  return 'weekday_late' // 21-04
}
