import { z } from 'zod'
import type { ToolContext } from './types'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

type ReviewTransaction = {
  id: string
  description: string
  amount: number
  date: string
  category_id: string | null
  value_category: string | null
  value_confidence: number | null
}

type ReviewGroup = {
  merchant: string
  transaction_count: number
  total_spend: number
  current_value_category: string
  examples: Array<{
    transaction_id: string
    description: string
    amount: number
    date: string
    formatted_date: string
    time_of_day: string
    day_of_week: string
    value_category: string
    value_confidence: number
  }>
  context_hints: {
    has_time_variance: boolean
    has_amount_variance: boolean
    has_day_variance: boolean
    suggested_question: string
  }
  learning_score: number
}

export function createGetValueReviewQueueTool(ctx: ToolContext) {
  return {
    description:
      'Fetch the highest-priority transactions for the user to value-classify, grouped by merchant. ' +
      'Prioritises transactions where the system can learn the most — merchants with contextual variance ' +
      '(same shop at different times/days), high spend, or many transactions. ' +
      'Use when naturally discussing values or when the value mapping context suggests it.',
    inputSchema: z.object({
      max_groups: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe('Maximum merchant groups to return. Default: 3.'),
      max_per_group: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe('Maximum example transactions per group. Default: 3.'),
    }),
    execute: async ({
      max_groups,
      max_per_group,
    }: {
      max_groups?: number
      max_per_group?: number
    }) => {
      try {
        const maxGroups = Math.min(max_groups || 3, 5)
        const maxPerGroup = Math.min(max_per_group || 3, 5)

        // Fetch review candidates (uses idx_txn_value_review partial index)
        const { data: candidates, error } = await ctx.supabase
          .from('transactions')
          .select(
            'id, description, amount, date, category_id, value_category, value_confidence'
          )
          .eq('user_id', ctx.userId)
          .eq('value_confirmed_by_user', false)
          .lt('value_confidence', 0.7)
          .lt('amount', 0)
          .order('value_confidence', { ascending: true })
          .limit(500)

        if (error) {
          console.error('[tool:get_value_review_queue] DB error:', error)
          return { error: 'Could not fetch transactions. Please try again.' }
        }

        if (!candidates || candidates.length === 0) {
          return {
            groups: [],
            total_unreviewed: 0,
            currency: ctx.currency,
            message:
              'No uncertain transactions to review. All value categories are either confirmed or high-confidence.',
          }
        }

        // Group by normalised merchant
        const merchantMap = new Map<string, ReviewTransaction[]>()
        for (const txn of candidates) {
          const merchant = normaliseMerchant(txn.description || '')
          if (!merchant) continue
          const group = merchantMap.get(merchant) || []
          group.push(txn)
          merchantMap.set(merchant, group)
        }

        // Score each merchant group
        const scoredGroups: Array<{
          merchant: string
          transactions: ReviewTransaction[]
          score: number
          hasTimeVariance: boolean
          hasDayVariance: boolean
          hasAmountVariance: boolean
        }> = []

        for (const [merchant, transactions] of merchantMap) {
          if (transactions.length === 0) continue

          const hours = transactions.map((t) => new Date(t.date).getHours())
          const days = transactions.map((t) => new Date(t.date).getDay())
          const amounts = transactions.map((t) => Math.abs(Number(t.amount)))

          const hasTimeVariance =
            new Set(hours).size >= 2 &&
            Math.max(...hours) - Math.min(...hours) > 4
          const hasDayVariance =
            days.some((d) => d === 0 || d === 6) &&
            days.some((d) => d >= 1 && d <= 5)
          const hasAmountVariance =
            amounts.length >= 2 && Math.max(...amounts) > Math.min(...amounts) * 1.5

          let score = 0
          if (hasTimeVariance) score += 30
          if (hasDayVariance) score += 20
          if (hasAmountVariance) score += 15

          const totalSpend = amounts.reduce((s, a) => s + a, 0)
          score += Math.min(totalSpend / 10, 20)
          score += Math.min(transactions.length * 2, 15)

          const avgConfidence =
            transactions.reduce(
              (s, t) => s + (Number(t.value_confidence) || 0.3),
              0
            ) / transactions.length
          score += (1 - avgConfidence) * 20

          scoredGroups.push({
            merchant,
            transactions,
            score,
            hasTimeVariance,
            hasDayVariance,
            hasAmountVariance,
          })
        }

        // Sort by score, take top N
        scoredGroups.sort((a, b) => b.score - a.score)
        const topGroups = scoredGroups.slice(0, maxGroups)

        // Build output groups
        const groups: ReviewGroup[] = topGroups.map((g) => {
          const examples = pickDiverseExamples(g.transactions, maxPerGroup)
          const mostCommonValue = getMostCommon(
            g.transactions.map((t) => t.value_category || 'unsure')
          )

          return {
            merchant: g.merchant,
            transaction_count: g.transactions.length,
            total_spend: g.transactions.reduce(
              (s, t) => s + Math.abs(Number(t.amount)),
              0
            ),
            current_value_category: mostCommonValue,
            examples,
            context_hints: {
              has_time_variance: g.hasTimeVariance,
              has_amount_variance: g.hasAmountVariance,
              has_day_variance: g.hasDayVariance,
              suggested_question: generateQuestionHint(
                g.merchant,
                g.hasTimeVariance,
                g.hasDayVariance,
                g.hasAmountVariance
              ),
            },
            learning_score: Math.round(g.score),
          }
        })

        return {
          groups,
          total_unreviewed: candidates.length,
          currency: ctx.currency,
        }
      } catch (err) {
        console.error('[tool:get_value_review_queue] unexpected error:', err)
        return {
          error: 'Something went wrong building the review queue. Please try again.',
        }
      }
    },
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function pickDiverseExamples(
  transactions: ReviewTransaction[],
  count: number
) {
  const result: ReviewGroup['examples'] = []
  const usedContexts = new Set<string>()

  // Sort by diversity potential: spread across different contexts
  const sorted = [...transactions].sort((a, b) => {
    const confA = Number(a.value_confidence) || 0
    const confB = Number(b.value_confidence) || 0
    return confA - confB // most uncertain first
  })

  for (const txn of sorted) {
    const d = new Date(txn.date)
    const dayType = getDayType(d)
    const timeOfDay = getTimeOfDay(d.getHours())
    const contextKey = `${dayType}-${timeOfDay}`

    // Prefer transactions from different contexts
    if (usedContexts.has(contextKey) && result.length > 0 && result.length < count) {
      // Still add if we haven't hit the limit, but prioritise new contexts
      continue
    }

    usedContexts.add(contextKey)
    result.push({
      transaction_id: txn.id,
      description: txn.description || '',
      amount: Math.abs(Number(txn.amount)),
      date: txn.date,
      formatted_date: formatDate(d),
      time_of_day: timeOfDay,
      day_of_week: getDayName(d.getDay()),
      value_category: txn.value_category || 'unsure',
      value_confidence: Number(txn.value_confidence) || 0,
    })

    if (result.length >= count) break
  }

  // If we skipped some due to context dedup, backfill
  if (result.length < count) {
    for (const txn of sorted) {
      if (result.some((r) => r.transaction_id === txn.id)) continue
      const d = new Date(txn.date)
      result.push({
        transaction_id: txn.id,
        description: txn.description || '',
        amount: Math.abs(Number(txn.amount)),
        date: txn.date,
        formatted_date: formatDate(d),
        time_of_day: getTimeOfDay(d.getHours()),
        day_of_week: getDayName(d.getDay()),
        value_category: txn.value_category || 'unsure',
        value_confidence: Number(txn.value_confidence) || 0,
      })
      if (result.length >= count) break
    }
  }

  return result
}

function getTimeOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

function getDayType(d: Date): string {
  const day = d.getDay()
  const hour = d.getHours()
  if (day === 5 && hour >= 17) return 'friday_evening'
  if (day === 0 || day === 6) return 'weekend'
  return 'weekday'
}

function getDayName(day: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]
}

function formatDate(d: Date): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}, ${hours}:${mins}`
}

function getMostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  let max = 0
  let result = 'unsure'
  for (const [value, count] of counts) {
    if (count > max) {
      max = count
      result = value
    }
  }
  return result
}

function generateQuestionHint(
  merchant: string,
  hasTimeVariance: boolean,
  hasDayVariance: boolean,
  hasAmountVariance: boolean
): string {
  if (hasTimeVariance && hasDayVariance) {
    return `Ask if ${merchant} feels different on weekday mornings vs weekend evenings`
  }
  if (hasTimeVariance) {
    return `Ask if ${merchant} serves a different purpose at different times of day`
  }
  if (hasDayVariance) {
    return `Ask if weekday vs weekend visits to ${merchant} feel different`
  }
  if (hasAmountVariance) {
    return `Ask about the difference between small and large ${merchant} orders`
  }
  return `Ask how ${merchant} fits into their life — essential, enjoyable, or something they'd rather cut?`
}
