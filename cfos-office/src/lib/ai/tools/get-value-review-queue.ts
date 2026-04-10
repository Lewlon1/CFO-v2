import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
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

type ScoredMerchantGroup = {
  merchant: string
  transactions: ReviewTransaction[]
  score: number
  hasTimeVariance: boolean
  hasDayVariance: boolean
  hasAmountVariance: boolean
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

export type ReviewIndividualTransaction = {
  transaction_id: string
  description: string
  merchant: string
  amount: number
  date: string
  formatted_date: string
  time_of_day: string
  day_of_week: string
  category_id: string | null
  value_category: string | null
  value_confidence: number
  learning_score: number
}

// ── Shared helpers (exported for reuse) ────────────────────────────────

/**
 * Fetch uncertain value-classification candidates for a user and group them
 * by normalised merchant, scoring each group by learning value.
 * Returns scored groups sorted high → low.
 */
export async function fetchAndScoreReviewCandidates(
  supabase: SupabaseClient,
  userId: string
): Promise<{ scoredGroups: ScoredMerchantGroup[]; totalCandidates: number }> {
  const { data: candidates, error } = await supabase
    .from('transactions')
    .select(
      'id, description, amount, date, category_id, value_category, value_confidence'
    )
    .eq('user_id', userId)
    .eq('value_confirmed_by_user', false)
    .or('value_confidence.is.null,value_confidence.lt.0.7')
    .lt('amount', 0)
    .order('value_confidence', { ascending: true, nullsFirst: true })
    .limit(500)

  if (error) throw new Error(`DB error: ${error.message}`)
  if (!candidates || candidates.length === 0) {
    return { scoredGroups: [], totalCandidates: 0 }
  }

  // Group by normalised merchant
  const merchantMap = new Map<string, ReviewTransaction[]>()
  for (const txn of candidates) {
    const merchant = normaliseMerchant(txn.description || '')
    if (!merchant) continue
    const group = merchantMap.get(merchant) || []
    group.push(txn as ReviewTransaction)
    merchantMap.set(merchant, group)
  }

  // Score each merchant group
  const scoredGroups: ScoredMerchantGroup[] = []
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

  scoredGroups.sort((a, b) => b.score - a.score)
  return { scoredGroups, totalCandidates: candidates.length }
}

/**
 * Unified selection helper used by both the get_value_review_queue tool
 * (format: 'groups') and the /api/value-map/checkin endpoint (format: 'individual').
 *
 * - format: 'groups' — top N merchant groups with 2–3 diverse example transactions each.
 * - format: 'individual' — flat list of top-scored individual transactions for a
 *   card-based exercise UI, capped per merchant to ensure variety.
 */
export async function selectValueReviewCandidates(
  supabase: SupabaseClient,
  userId: string,
  opts:
    | {
        format: 'groups'
        maxGroups?: number
        maxPerGroup?: number
      }
    | {
        format: 'individual'
        minCount?: number
        maxCount?: number
        maxPerMerchant?: number
      }
): Promise<
  | { format: 'groups'; groups: ReviewGroup[]; totalCandidates: number }
  | {
      format: 'individual'
      transactions: ReviewIndividualTransaction[]
      totalCandidates: number
      categoriesRepresented: string[]
    }
> {
  const { scoredGroups, totalCandidates } = await fetchAndScoreReviewCandidates(
    supabase,
    userId
  )

  if (opts.format === 'groups') {
    const maxGroups = Math.min(opts.maxGroups || 3, 5)
    const maxPerGroup = Math.min(opts.maxPerGroup || 3, 5)
    const topGroups = scoredGroups.slice(0, maxGroups)

    const groups: ReviewGroup[] = topGroups.map((g) => {
      const examples = pickDiverseExamples(g.transactions, maxPerGroup)
      const mostCommonValue = getMostCommon(
        g.transactions.map((t) => t.value_category || 'no_idea')
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

    return { format: 'groups', groups, totalCandidates }
  }

  // format === 'individual'
  //
  // Selection strategy: prefer BREADTH over depth.
  // - Pass 1: one representative transaction per merchant group, walking in priority order.
  //   This maximises the number of unique merchants the user classifies — one
  //   explicit decision about "Aldi" teaches us about ALL Aldi transactions via rule
  //   propagation, so a second Aldi card has diminishing returns.
  // - Pass 2: for merchants with STRONG contextual variance (different time-of-day AND
  //   different day-type, OR very different amounts), add ONE contrasting transaction
  //   so the system can learn a contextual rule like "Aldi at 11pm = leak, Aldi at noon = foundation".
  //   Never more than 2 per merchant.
  const maxCount = Math.min(opts.maxCount ?? 12, 20)
  const maxPerMerchant = Math.min(opts.maxPerMerchant ?? 2, 3)

  const result: ReviewIndividualTransaction[] = []
  const addedByMerchant = new Map<string, ReviewTransaction[]>()

  const push = (g: ScoredMerchantGroup, txn: ReviewTransaction) => {
    const d = new Date(txn.date)
    result.push({
      transaction_id: txn.id,
      description: txn.description || '',
      merchant: g.merchant,
      amount: Math.abs(Number(txn.amount)),
      date: txn.date,
      formatted_date: formatDate(d),
      time_of_day: getTimeOfDay(d.getHours()),
      day_of_week: getDayName(d.getDay()),
      category_id: txn.category_id,
      value_category: txn.value_category,
      value_confidence: Number(txn.value_confidence) || 0,
      learning_score: Math.round(g.score),
    })
    const existing = addedByMerchant.get(g.merchant) ?? []
    existing.push(txn)
    addedByMerchant.set(g.merchant, existing)
  }

  // ── Pass 1: one representative transaction per merchant ──
  for (const g of scoredGroups) {
    if (result.length >= maxCount) break

    const sorted = [...g.transactions].sort((a, b) => {
      const confA = Number(a.value_confidence) || 0
      const confB = Number(b.value_confidence) || 0
      if (confA !== confB) return confA - confB
      return Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))
    })
    push(g, sorted[0])
  }

  // ── Pass 2: add ONE contrasting transaction for high-variance merchants ──
  // Only kicks in if we still have card slots left AND the merchant genuinely
  // has contextual variance worth asking about separately.
  if (maxPerMerchant >= 2 && result.length < maxCount) {
    for (const g of scoredGroups) {
      if (result.length >= maxCount) break
      const alreadyAdded = addedByMerchant.get(g.merchant) ?? []
      if (alreadyAdded.length === 0 || alreadyAdded.length >= maxPerMerchant) continue

      // Require STRONG variance — at least two variance signals OR clear amount spread
      const strongVariance =
        (g.hasTimeVariance && g.hasDayVariance) ||
        (g.hasTimeVariance && g.hasAmountVariance) ||
        (g.hasDayVariance && g.hasAmountVariance)
      if (!strongVariance) continue

      // Find a transaction that genuinely contrasts with the one we already added
      const firstTxn = alreadyAdded[0]
      const firstDate = new Date(firstTxn.date)
      const firstTimeBucket = getTimeOfDay(firstDate.getHours())
      const firstDayType = getDayType(firstDate)
      const firstAmount = Math.abs(Number(firstTxn.amount))

      const contrasting = g.transactions.find((t) => {
        if (t.id === firstTxn.id) return false
        const d = new Date(t.date)
        const timeDiffers = getTimeOfDay(d.getHours()) !== firstTimeBucket
        const dayDiffers = getDayType(d) !== firstDayType
        const amountDiffers =
          Math.abs(Number(t.amount)) > firstAmount * 1.5 ||
          Math.abs(Number(t.amount)) * 1.5 < firstAmount
        return timeDiffers || dayDiffers || amountDiffers
      })

      if (contrasting) push(g, contrasting)
    }
  }

  // ── Pass 3 (fallback): if still under maxCount, backfill from remaining transactions ──
  // Only fires when there aren't enough merchants to hit maxCount on pass 1 alone.
  if (result.length < maxCount) {
    for (const g of scoredGroups) {
      if (result.length >= maxCount) break
      const alreadyAdded = addedByMerchant.get(g.merchant) ?? []
      if (alreadyAdded.length >= maxPerMerchant) continue
      const seen = new Set(alreadyAdded.map((t) => t.id))
      const next = g.transactions.find((t) => !seen.has(t.id))
      if (next) push(g, next)
    }
  }

  // Collect unique category_ids represented
  const categoriesRepresented = [
    ...new Set(result.map((r) => r.category_id).filter((c): c is string => !!c)),
  ]

  return {
    format: 'individual',
    transactions: result,
    totalCandidates,
    categoriesRepresented,
  }
}

// ── Tool factory ───────────────────────────────────────────────────────

export function createGetValueReviewQueueTool(ctx: ToolContext) {
  return {
    description:
      'Fetch merchant groups for INLINE mid-conversation discussion — NOT for batch check-ins. ' +
      'Use ONLY when a spending topic came up naturally and you want to ask the user about ONE merchant ' +
      'group conversationally (e.g. "so what\'s the story with the three Aldi trips?"). ' +
      'DO NOT use this tool when the user explicitly asks for a "check-in", "Value Map", or wants to ' +
      'classify a batch of transactions — use check_value_checkin_ready instead, which routes them ' +
      'to a dedicated card-based UI. ' +
      'One group at a time, maximum 2 groups per conversation, always woven into the dialogue.',
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
        const result = await selectValueReviewCandidates(ctx.supabase, ctx.userId, {
          format: 'groups',
          maxGroups: max_groups,
          maxPerGroup: max_per_group,
        })

        if (result.format !== 'groups') {
          // Narrow for TS; this branch is unreachable in practice.
          return { error: 'Unexpected selection format' }
        }

        if (result.groups.length === 0) {
          return {
            groups: [],
            total_unreviewed: result.totalCandidates,
            currency: ctx.currency,
            message:
              'No uncertain transactions to review. All value categories are either confirmed or high-confidence.',
          }
        }

        return {
          groups: result.groups,
          total_unreviewed: result.totalCandidates,
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
      value_category: txn.value_category || 'no_idea',
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
        value_category: txn.value_category || 'no_idea',
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
  let result = 'no_idea'
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
