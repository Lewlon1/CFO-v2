// Sunday callback scheduling for active experiments. Used by the wow-moment
// generator to populate `callback_due_at` and (in Session 27) by the cron
// runner reading the partial index `where status='active'`.

export interface NextSundayOptions {
  hourUTC: number
  minDaysAhead: number
  maxDaysAhead: number
}

export function nextSundayAt(from: Date, opts: NextSundayOptions): Date {
  if (opts.minDaysAhead < 0 || opts.maxDaysAhead < opts.minDaysAhead) {
    throw new Error(
      `Invalid window: minDaysAhead=${opts.minDaysAhead} maxDaysAhead=${opts.maxDaysAhead}`,
    )
  }

  const SUNDAY = 0
  const fromDay = from.getUTCDay()
  // First Sunday on or after `from`.
  let daysAhead = (SUNDAY - fromDay + 7) % 7
  // Bump by full weeks until the gap satisfies minDaysAhead.
  while (daysAhead < opts.minDaysAhead) daysAhead += 7
  if (daysAhead > opts.maxDaysAhead) {
    throw new Error(
      `No Sunday in [${opts.minDaysAhead}, ${opts.maxDaysAhead}] days from ${from.toISOString()}`,
    )
  }

  const result = new Date(from.getTime())
  result.setUTCDate(from.getUTCDate() + daysAhead)
  result.setUTCHours(opts.hourUTC, 0, 0, 0)
  return result
}
