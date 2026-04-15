import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ───────────────────────────────────────────────────────────────────

export interface RecurringCard {
  count: number
  totalMonthlyEstimate: number
  topItems: Array<{
    merchant: string
    amount: number
    frequency: string
    monthlyEquivalent: number
  }>
}

export interface LeakCard {
  merchant: string
  totalSpent: number
  transactionCount: number
  monthsObserved: number
  monthlyAvg: number
}

export interface ValueBreakdownCard {
  foundation: { amount: number; percentage: number }
  investment: { amount: number; percentage: number }
  burden: { amount: number; percentage: number }
  leak: { amount: number; percentage: number }
  totalSpend: number
  classifiedCount: number
}

export interface FirstInsightCards {
  currency: string
  recurring: RecurringCard | null
  leak: LeakCard | null
  valueBreakdown: ValueBreakdownCard | null
  generatedAt: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const MONTHLY_MULTIPLIER: Record<string, number> = {
  weekly: 4.33,
  'bi-weekly': 2.17,
  biweekly: 2.17,
  fortnightly: 2.17,
  monthly: 1,
  'bi-monthly': 0.5,
  bimonthly: 0.5,
  quarterly: 1 / 3,
  'semi-annual': 1 / 6,
  semiannual: 1 / 6,
  annual: 1 / 12,
  yearly: 1 / 12,
}

function toMonthly(amount: number, frequency: string): number {
  const key = (frequency ?? 'monthly').toLowerCase()
  const mult = MONTHLY_MULTIPLIER[key]
  // Irregular / unknown → treat as monthly-ish conservatively
  if (mult === undefined) return amount
  return amount * mult
}

function monthsBetween(earliest: Date, latest: Date): number {
  const ms = latest.getTime() - earliest.getTime()
  const months = ms / (1000 * 60 * 60 * 24 * 30)
  return Math.max(1, Math.round(months * 10) / 10)
}

// ── Recurring card ──────────────────────────────────────────────────────────

async function computeRecurring(
  supabase: SupabaseClient,
  userId: string,
): Promise<RecurringCard | null> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('name, provider, amount, frequency, status')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .in('status', ['tracked', 'detected'])

  if (error || !data || data.length === 0) return null

  const items = data.map((r) => {
    const amount = Math.abs(Number(r.amount ?? 0))
    const monthly = toMonthly(amount, r.frequency)
    return {
      merchant: (r.provider ?? r.name ?? 'Unknown') as string,
      amount,
      frequency: r.frequency as string,
      monthlyEquivalent: monthly,
    }
  })

  const totalMonthly = items.reduce((s, i) => s + i.monthlyEquivalent, 0)
  if (totalMonthly === 0) return null

  const topItems = [...items]
    .sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent)
    .slice(0, 3)

  return {
    count: items.length,
    totalMonthlyEstimate: Math.round(totalMonthly * 100) / 100,
    topItems,
  }
}

// ── Biggest Leak card ───────────────────────────────────────────────────────

async function computeLeak(
  supabase: SupabaseClient,
  userId: string,
): Promise<LeakCard | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select('description, raw_description, amount, date')
    .eq('user_id', userId)
    .eq('value_category', 'leak')
    .is('deleted_at', null)

  if (error || !data || data.length === 0) return null

  // Group by normalised merchant name (description, fallback raw_description)
  const byMerchant = new Map<
    string,
    { total: number; count: number; earliest: Date; latest: Date }
  >()

  for (const tx of data) {
    const merchant = ((tx.description ?? tx.raw_description ?? 'Unknown') as string).trim()
    if (!merchant) continue
    const abs = Math.abs(Number(tx.amount ?? 0))
    if (abs === 0) continue
    const d = new Date(tx.date as string)
    const existing = byMerchant.get(merchant)
    if (existing) {
      existing.total += abs
      existing.count += 1
      if (d < existing.earliest) existing.earliest = d
      if (d > existing.latest) existing.latest = d
    } else {
      byMerchant.set(merchant, { total: abs, count: 1, earliest: d, latest: d })
    }
  }

  if (byMerchant.size === 0) return null

  let topMerchant: string | null = null
  let topStats: { total: number; count: number; earliest: Date; latest: Date } | null = null
  for (const [merchant, stats] of byMerchant) {
    if (!topStats || stats.total > topStats.total) {
      topMerchant = merchant
      topStats = stats
    }
  }

  if (!topMerchant || !topStats) return null

  const months = monthsBetween(topStats.earliest, topStats.latest)
  return {
    merchant: topMerchant,
    totalSpent: Math.round(topStats.total * 100) / 100,
    transactionCount: topStats.count,
    monthsObserved: months,
    monthlyAvg: Math.round((topStats.total / months) * 100) / 100,
  }
}

// ── Value breakdown card ────────────────────────────────────────────────────

async function computeValueBreakdown(
  supabase: SupabaseClient,
  userId: string,
): Promise<ValueBreakdownCard | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select('value_category, amount')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .lt('amount', 0) // expenses only

  if (error || !data || data.length === 0) return null

  const totals = { foundation: 0, investment: 0, burden: 0, leak: 0 }
  let classifiedCount = 0

  for (const tx of data) {
    const vc = tx.value_category as keyof typeof totals | 'no_idea' | null
    if (!vc || vc === 'no_idea') continue
    if (vc in totals) {
      totals[vc] += Math.abs(Number(tx.amount ?? 0))
      classifiedCount += 1
    }
  }

  const totalSpend = totals.foundation + totals.investment + totals.burden + totals.leak
  if (totalSpend === 0) return null

  const pct = (v: number) => Math.round((v / totalSpend) * 1000) / 10

  return {
    foundation: { amount: Math.round(totals.foundation * 100) / 100, percentage: pct(totals.foundation) },
    investment: { amount: Math.round(totals.investment * 100) / 100, percentage: pct(totals.investment) },
    burden: { amount: Math.round(totals.burden * 100) / 100, percentage: pct(totals.burden) },
    leak: { amount: Math.round(totals.leak * 100) / 100, percentage: pct(totals.leak) },
    totalSpend: Math.round(totalSpend * 100) / 100,
    classifiedCount,
  }
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function computeFirstInsight(
  supabase: SupabaseClient,
  userId: string,
  currency: string,
): Promise<FirstInsightCards> {
  const [recurring, leak, valueBreakdown] = await Promise.all([
    computeRecurring(supabase, userId),
    computeLeak(supabase, userId),
    computeValueBreakdown(supabase, userId),
  ])

  return {
    currency,
    recurring,
    leak,
    valueBreakdown,
    generatedAt: new Date().toISOString(),
  }
}
