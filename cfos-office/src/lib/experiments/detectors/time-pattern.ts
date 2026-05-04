import type { Detector } from '../types'
import { currencySymbol } from '../observation-templates'

const MIN_WEEKEND_DAYS = 4
const MIN_WEEKDAY_DAYS = 10
const MIN_WEEKDAY_AVG = 5
const TRIGGER_RATIO = 1.5

// Detects spending that's much heavier on weekends than weekdays. Excludes
// Foundation transactions (rent / bills hit on payment day, not lifestyle
// day) so the pattern reflects discretionary spend, not direct debit timing.
export const timePatternDetector: Detector = async ({ transactions, currency }) => {
  let weekendSpend = 0
  let weekdaySpend = 0
  const weekendDays = new Set<string>()
  const weekdayDays = new Set<string>()

  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    if (tx.category === 'income' || tx.category === 'transfer') continue
    if (tx.value_category === 'foundation') continue
    const date = new Date(tx.date)
    if (Number.isNaN(date.getTime())) continue
    const dow = date.getUTCDay()
    const amt = Math.abs(tx.amount)
    const dayKey = tx.date.slice(0, 10)
    if (dow === 0 || dow === 6) {
      weekendSpend += amt
      weekendDays.add(dayKey)
    } else {
      weekdaySpend += amt
      weekdayDays.add(dayKey)
    }
  }

  if (weekendDays.size < MIN_WEEKEND_DAYS) return []
  if (weekdayDays.size < MIN_WEEKDAY_DAYS) return []

  const weekendAvg = weekendSpend / weekendDays.size
  const weekdayAvg = weekdaySpend / weekdayDays.size
  if (weekdayAvg < MIN_WEEKDAY_AVG) return []
  const ratio = weekendAvg / weekdayAvg
  if (ratio < TRIGGER_RATIO) return []

  const score = Math.min((ratio - TRIGGER_RATIO) / TRIGGER_RATIO, 1)
  return [
    {
      observation_type: 'time_pattern',
      pattern_template_key: 'weekend_clock',
      candidate_score: score,
      payload: {
        ratio: ratio.toFixed(1),
        currency_symbol: currencySymbol(currency),
        weekend_label: 'weekend spending',
        weekend_avg: Math.round(weekendAvg),
        weekday_avg: Math.round(weekdayAvg),
      },
      currency,
    },
  ]
}
